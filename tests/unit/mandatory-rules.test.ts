// ============================================================================
// Unit Tests: Mandatory Rule Verification
// Filename handling, exact duplicate detection, person identification, in-flight modification
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';

// Mock electron app before imports
vi.mock('electron', () => ({
  app: {
    getPath: () => os.tmpdir(),
  },
}));

// In-memory Mock Database for reliable test execution
class MockRulesDatabase {
  public files: any[] = [];
  public roots: any[] = [];
  public people: any[] = [];
  public filePeople: any[] = [];
  public duplicateGroups: any[] = [];
  public duplicateGroupFiles: any[] = [];

  transaction(fn: Function) {
    return (...args: any[]) => fn(...args);
  }

  prepare(sql: string) {
    // ── Duplicate Groups Queries ──
    if (sql.includes('SELECT hash_sha256, COUNT(*) as file_count')) {
      return {
        all: () => {
          const map = new Map<string, { count: number; totalSize: number }>();
          for (const f of this.files) {
            if (f.hash_sha256) {
              const current = map.get(f.hash_sha256) || { count: 0, totalSize: 0 };
              current.count++;
              current.totalSize += f.size_bytes || 0;
              map.set(f.hash_sha256, current);
            }
          }
          const results: any[] = [];
          for (const [hash, val] of map.entries()) {
            if (val.count > 1) {
              results.push({ hash_sha256: hash, file_count: val.count, total_size: val.totalSize });
            }
          }
          return results;
        },
      };
    }

    if (sql.includes('SELECT id, file_created_at FROM files WHERE hash_sha256 = ?')) {
      return {
        all: (hash: string) => {
          return this.files
            .filter(f => f.hash_sha256 === hash)
            .sort((a, b) => (a.file_created_at || '').localeCompare(b.file_created_at || ''))
            .map(f => ({ id: f.id, file_created_at: f.file_created_at }));
        },
      };
    }

    if (sql.includes('DELETE FROM duplicate_groups WHERE status =')) {
      return {
        run: () => {
          this.duplicateGroups = this.duplicateGroups.filter(g => g.status !== 'pending');
        },
      };
    }

    if (sql.includes('INSERT INTO duplicate_groups')) {
      return {
        run: (id: string, type: string, hash: string, sim: number, count: number, size: number) => {
          this.duplicateGroups.push({ id, type, hash, similarity_score: sim, file_count: count, total_size: size, status: 'pending' });
        },
      };
    }

    if (sql.includes('INSERT INTO duplicate_group_files')) {
      return {
        run: (groupId: string, fileId: string, isOriginal: number) => {
          this.duplicateGroupFiles.push({ group_id: groupId, file_id: fileId, is_original: isOriginal });
        },
      };
    }

    if (sql.includes('SELECT * FROM duplicate_groups WHERE hash = ?')) {
      return {
        all: (hash: string) => this.duplicateGroups.filter(g => g.hash === hash),
      };
    }

    if (sql.includes('SELECT * FROM duplicate_groups WHERE status =')) {
      return {
        all: () => [...this.duplicateGroups],
      };
    }

    if (sql.includes('SELECT dgf.*, f.relative_path, f.filename')) {
      return {
        all: (groupId: string) => {
          return this.duplicateGroupFiles
            .filter(dgf => dgf.group_id === groupId)
            .map(dgf => {
              const f = this.files.find(file => file.id === dgf.file_id) || {};
              return { ...dgf, relative_path: f.relative_path, filename: f.filename };
            })
            .sort((a, b) => b.is_original - a.is_original);
        },
      };
    }

    // ── Organization Proposals Query ──
    if (sql.includes('FROM files f') && sql.includes('JOIN roots r')) {
      return {
        all: (...params: any[]) => {
          let filtered = this.files.filter(f => !f.is_missing);
          if (params.length > 0) {
            filtered = filtered.filter(f => params.includes(f.id) || params.includes(f.root_id));
          }

          return filtered.map(f => {
            const root = this.roots.find(r => r.id === f.root_id) || { path: '' };

            // Determine confirmed people associations
            // Strictly requires review_status IN ('confirmed', 'reviewed') OR association_type = 'confirmed'
            const confirmedNames: string[] = [];
            const linked = this.filePeople.filter(fp => fp.file_id === f.id);
            for (const link of linked) {
              const p = this.people.find(person => person.id === link.person_id);
              if (p && !p.is_hidden && !p.is_excluded) {
                if (['confirmed', 'reviewed'].includes(p.review_status) || link.association_type === 'confirmed') {
                  if (!confirmedNames.includes(p.name)) {
                    confirmedNames.push(p.name);
                  }
                }
              }
            }

            confirmedNames.sort((a, b) => a.localeCompare(b));
            const person_name = confirmedNames.length > 0 ? confirmedNames.join(' & ') : null;

            return {
              ...f,
              root_path: root.path,
              person_name,
              city: null,
              country: null,
              event_name: null,
            };
          });
        },
      };
    }

    return {
      run: () => {},
      get: () => null,
      all: () => [],
    };
  }
}

let mockDb = new MockRulesDatabase();
vi.mock('../../src/main/database', () => ({
  getDb: () => mockDb,
}));

import { recalculateDuplicates } from '../../src/main/indexer';
import {
  computeFileSha256,
  copyFileWithVerification,
  resolveSafeDestinationPath,
} from '../../src/main/file-operations';
import {
  resolveOrganizationPath,
  generateOrganizationProposals,
} from '../../src/main/organizer';

describe('Mandatory Rule: Filename, Duplicate Detection & Person Identification', () => {
  let testDir: string;

  beforeEach(() => {
    mockDb = new MockRulesDatabase();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexora-rules-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  // ─── 1. Identical Filenames with Different Contents ────────────────────────
  it('treats identical filenames with different contents as distinct non-duplicates', async () => {
    const rootId = uuidv4();
    const folderA = path.join(testDir, 'folderA');
    const folderB = path.join(testDir, 'folderB');
    fs.mkdirSync(folderA, { recursive: true });
    fs.mkdirSync(folderB, { recursive: true });

    mockDb.roots.push({ id: rootId, path: testDir, label: 'Test Root' });

    // Two files with identical filename "document.pdf" but different contents
    const fileAPath = path.join(folderA, 'document.pdf');
    const fileBPath = path.join(folderB, 'document.pdf');
    fs.writeFileSync(fileAPath, 'Content of document A - version 1');
    fs.writeFileSync(fileBPath, 'Content of document B - completely different content 2');

    const hashA = await computeFileSha256(fileAPath);
    const hashB = await computeFileSha256(fileBPath);
    expect(hashA).not.toBe(hashB);

    const fileIdA = uuidv4();
    const fileIdB = uuidv4();

    mockDb.files.push({
      id: fileIdA,
      root_id: rootId,
      relative_path: 'folderA/document.pdf',
      filename: 'document.pdf',
      extension: '.pdf',
      size_bytes: 33,
      hash_sha256: hashA,
      file_created_at: '2024-01-01 10:00:00',
    });

    mockDb.files.push({
      id: fileIdB,
      root_id: rootId,
      relative_path: 'folderB/document.pdf',
      filename: 'document.pdf',
      extension: '.pdf',
      size_bytes: 54,
      hash_sha256: hashB,
      file_created_at: '2024-01-02 10:00:00',
    });

    // Recalculate duplicates: distinct content hashes must NOT create any duplicate groups
    recalculateDuplicates();
    expect(mockDb.duplicateGroups.length).toBe(0);

    // Destination collision resolution: different contents with same name get numbered suffix (document (1).pdf)
    const destDir = path.join(testDir, 'organized');
    fs.mkdirSync(destDir, { recursive: true });
    const targetFile = path.join(destDir, 'document.pdf');
    fs.writeFileSync(targetFile, 'Existing destination document');

    const collisionRes = await resolveSafeDestinationPath(targetFile, hashA);
    expect(collisionRes.isIdenticalDuplicate).toBe(false);
    expect(collisionRes.finalPath).toBe(path.join(destDir, 'document (1).pdf'));
  });

  // ─── 2. Different Filenames with Identical Contents ────────────────────────
  it('detects different filenames with identical content as exact duplicates without deleting records', async () => {
    const rootId = uuidv4();
    mockDb.roots.push({ id: rootId, path: testDir, label: 'Test Root' });

    const identicalContent = 'Identical binary/text payload across different file names';
    const path1 = path.join(testDir, 'original_photo.jpg');
    const path2 = path.join(testDir, 'backup_copy.jpg');
    fs.writeFileSync(path1, identicalContent);
    fs.writeFileSync(path2, identicalContent);

    const hash1 = await computeFileSha256(path1);
    const hash2 = await computeFileSha256(path2);
    expect(hash1).toBe(hash2);

    const fileId1 = uuidv4();
    const fileId2 = uuidv4();

    mockDb.files.push({
      id: fileId1,
      root_id: rootId,
      relative_path: 'original_photo.jpg',
      filename: 'original_photo.jpg',
      extension: '.jpg',
      size_bytes: identicalContent.length,
      hash_sha256: hash1,
      file_created_at: '2024-01-01 10:00:00',
    });

    mockDb.files.push({
      id: fileId2,
      root_id: rootId,
      relative_path: 'backup_copy.jpg',
      filename: 'backup_copy.jpg',
      extension: '.jpg',
      size_bytes: identicalContent.length,
      hash_sha256: hash2,
      file_created_at: '2024-01-02 10:00:00',
    });

    recalculateDuplicates();

    expect(mockDb.duplicateGroups.length).toBe(1);
    expect(mockDb.duplicateGroups[0].type).toBe('exact');
    expect(mockDb.duplicateGroups[0].status).toBe('pending'); // Never automatically deleted!

    // Check separate records are maintained
    expect(mockDb.duplicateGroupFiles.length).toBe(2);
    const originalFile = mockDb.duplicateGroupFiles.find(dgf => dgf.is_original === 1);
    const dupFile = mockDb.duplicateGroupFiles.find(dgf => dgf.is_original === 0);
    expect(originalFile?.file_id).toBe(fileId1);
    expect(dupFile?.file_id).toBe(fileId2);

    // Verify safe destination detection: identical duplicate identified and preserved without overwrite
    const collisionRes = await resolveSafeDestinationPath(path1, hash2);
    expect(collisionRes.isIdenticalDuplicate).toBe(true);
    expect(collisionRes.finalPath).toBe(path1);
  });

  // ─── 3. Files Showing Different Confirmed People ───────────────────────────
  it('associates files showing different confirmed people with their respective identities', async () => {
    const rootId = uuidv4();
    mockDb.roots.push({ id: rootId, path: testDir, label: 'Test Root' });

    const personAlice = uuidv4();
    const personBob = uuidv4();

    mockDb.people.push({ id: personAlice, name: 'Alice', review_status: 'confirmed', is_hidden: 0, is_excluded: 0 });
    mockDb.people.push({ id: personBob, name: 'Bob', review_status: 'confirmed', is_hidden: 0, is_excluded: 0 });

    const fileAliceId = uuidv4();
    const fileBobId = uuidv4();

    mockDb.files.push({
      id: fileAliceId,
      root_id: rootId,
      relative_path: 'alice_photo.jpg',
      filename: 'alice_photo.jpg',
      extension: '.jpg',
      size_bytes: 1024,
      file_created_at: '2024-05-10T12:00:00Z',
    });

    mockDb.files.push({
      id: fileBobId,
      root_id: rootId,
      relative_path: 'bob_photo.jpg',
      filename: 'bob_photo.jpg',
      extension: '.jpg',
      size_bytes: 2048,
      file_created_at: '2024-05-11T12:00:00Z',
    });

    mockDb.filePeople.push({ file_id: fileAliceId, person_id: personAlice, association_type: 'confirmed' });
    mockDb.filePeople.push({ file_id: fileBobId, person_id: personBob, association_type: 'confirmed' });

    const summary = await generateOrganizationProposals({
      fileIds: [fileAliceId, fileBobId],
      rulePattern: 'People/{person}',
      destinationRoot: path.join(testDir, 'dest'),
    });

    expect(summary.totalFiles).toBe(2);
    const aliceProposal = summary.proposals.find(p => p.source_file_id === fileAliceId);
    const bobProposal = summary.proposals.find(p => p.source_file_id === fileBobId);

    expect(aliceProposal?.proposed_destination).toContain(path.join('People', 'Alice'));
    expect(bobProposal?.proposed_destination).toContain(path.join('People', 'Bob'));
  });

  // ─── 4. Files Showing Multiple Confirmed People ────────────────────────────
  it('supports multiple confirmed people in a single file by aggregating names', async () => {
    const rootId = uuidv4();
    mockDb.roots.push({ id: rootId, path: testDir, label: 'Test Root' });

    const personAlice = uuidv4();
    const personBob = uuidv4();

    mockDb.people.push({ id: personAlice, name: 'Alice', review_status: 'confirmed', is_hidden: 0, is_excluded: 0 });
    mockDb.people.push({ id: personBob, name: 'Bob', review_status: 'confirmed', is_hidden: 0, is_excluded: 0 });

    const groupPhotoId = uuidv4();
    mockDb.files.push({
      id: groupPhotoId,
      root_id: rootId,
      relative_path: 'group.jpg',
      filename: 'group.jpg',
      extension: '.jpg',
      size_bytes: 4096,
      file_created_at: '2024-06-01T15:00:00Z',
    });

    // Associate both confirmed people to the same file
    mockDb.filePeople.push({ file_id: groupPhotoId, person_id: personAlice, association_type: 'confirmed' });
    mockDb.filePeople.push({ file_id: groupPhotoId, person_id: personBob, association_type: 'confirmed' });

    const summary = await generateOrganizationProposals({
      fileIds: [groupPhotoId],
      rulePattern: 'Family/{person}',
      destinationRoot: path.join(testDir, 'dest'),
    });

    expect(summary.totalFiles).toBe(1);
    const groupProposal = summary.proposals[0];
    expect(groupProposal.proposed_destination).toContain(path.join('Family', 'Alice & Bob'));
  });

  // ─── 5. Uncertain Face Matches & Non-Inference from Filenames ───────────────
  it('keeps uncertain/unreviewed matches unassigned and never infers identity from filenames alone', async () => {
    const rootId = uuidv4();
    mockDb.roots.push({ id: rootId, path: testDir, label: 'Test Root' });

    // 1. Unreviewed cluster: should NOT be used in organization
    const personUnreviewed = uuidv4();
    mockDb.people.push({ id: personUnreviewed, name: 'Person 42', review_status: 'unreviewed', is_hidden: 0, is_excluded: 0 });

    const fileUncertainId = uuidv4();
    mockDb.files.push({
      id: fileUncertainId,
      root_id: rootId,
      relative_path: 'candidate.jpg',
      filename: 'candidate.jpg',
      extension: '.jpg',
      size_bytes: 1024,
      file_created_at: '2024-07-01T10:00:00Z',
    });

    mockDb.filePeople.push({ file_id: fileUncertainId, person_id: personUnreviewed, association_type: 'auto' });

    // 2. File named with a person name but no face match
    const fileNamedAliceId = uuidv4();
    mockDb.files.push({
      id: fileNamedAliceId,
      root_id: rootId,
      relative_path: 'Alice_at_the_beach.jpg',
      filename: 'Alice_at_the_beach.jpg',
      extension: '.jpg',
      size_bytes: 1024,
      file_created_at: '2024-07-01T10:00:00Z',
    });

    const summary = await generateOrganizationProposals({
      fileIds: [fileUncertainId, fileNamedAliceId],
      rulePattern: 'Organized/{person}',
      destinationRoot: path.join(testDir, 'dest'),
    });

    const uncertainProposal = summary.proposals.find(p => p.source_file_id === fileUncertainId);
    const namedAliceProposal = summary.proposals.find(p => p.source_file_id === fileNamedAliceId);

    // Uncertain face match must fallback to 'Unassigned'
    expect(uncertainProposal?.proposed_destination).toContain(path.join('Organized', 'Unassigned'));
    expect(uncertainProposal?.warnings.some(w => w.includes('No confirmed person identity'))).toBe(true);

    // Filename 'Alice_at_the_beach.jpg' must NEVER infer Alice without confirmed face recognition
    expect(namedAliceProposal?.proposed_destination).toContain(path.join('Organized', 'Unassigned'));
    expect(namedAliceProposal?.warnings.some(w => w.includes('No confirmed person identity'))).toBe(true);
  });

  // ─── 6. Explicit Filename Rule Tokens and Safe Fallback ────────────────────
  it('resolves explicit user-defined filename tokens and safe fallback for ambiguous tokens', () => {
    const file = {
      filename: 'financial_report_2024.pdf',
      relative_path: 'docs/financial_report_2024.pdf',
      extension: '.pdf',
      file_created_at: '2024-03-15T09:00:00Z',
    };

    // Pattern using explicit filename tokens {basename} and {ext}
    const resolvedTokens = resolveOrganizationPath(file, '{category}/{basename}/{ext}');
    expect(resolvedTokens.relativeFolder).toBe(path.join('Documents', 'financial_report_2024', 'pdf'));

    // Pattern using ambiguous or unknown token {client_name}
    const resolvedFallback = resolveOrganizationPath(file, '{category}/{client_name}');
    expect(resolvedFallback.relativeFolder).toBe(path.join('Documents', 'General'));
    expect(resolvedFallback.warnings.some(w => w.includes('Unresolved or ambiguous rule tokens'))).toBe(true);
  });

  // ─── 7. In-Flight File Modification Detection during Hashing and Copying ──
  it('detects file modifications during hashing or copying and prevents corrupted state', async () => {
    const sourceFile = path.join(testDir, 'modifying_source.dat');
    const destFile = path.join(testDir, 'dest', 'modifying_dest.dat');
    fs.writeFileSync(sourceFile, 'Initial stable content for hashing');

    // Test copyFileWithVerification failure when source is modified concurrently
    const copyPromise = copyFileWithVerification(sourceFile, destFile);
    // Mutate source concurrently while copy is in flight
    fs.appendFileSync(sourceFile, ' CONCURRENT_APPEND_DATA');
    fs.utimesSync(sourceFile, new Date(Date.now() + 5000), new Date(Date.now() + 5000));

    const copyResult = await copyPromise;
    // Either copy verification hash mismatch or source modification detected
    expect(copyResult.success).toBe(false);
    expect(copyResult.error).toBeDefined();

    // Destination file must NOT exist (temp file must have been unlinked)
    expect(fs.existsSync(destFile)).toBe(false);
  });
});
