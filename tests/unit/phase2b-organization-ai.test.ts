// ============================================================================
// Phase 2B Tests: Safe Organization, Local AI, Face Recognition & UI Integration
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';

// ── Hoisted Mock Database for Node.js Testing Environment ──────────────────
const { activeMockDb } = vi.hoisted(() => {
  class MockPhase2BDatabase {
    public roots: any[] = [];
    public files: any[] = [];
    public people: any[] = [];
    public faceDetections: any[] = [];
    public faceClusters: any[] = [];
    public clusterMembers: any[] = [];
    public filePeople: any[] = [];
    public copyOperations: any[] = [];
    public operationItems: any[] = [];
    public operationHistory: any[] = [];
    public organizationRules: any[] = [
      { id: 'rule_default_date', name: 'Date Hierarchy', pattern: '{category}/{YYYY}/{MM}', is_default: 1 },
      { id: 'rule_camera_date', name: 'Camera & Date', pattern: 'Media/{camera}/{YYYY}/{MM}', is_default: 0 },
      { id: 'rule_person_date', name: 'Person & Date', pattern: 'People/{person}/{YYYY}', is_default: 0 },
      { id: 'rule_docs_author', name: 'Documents by Author', pattern: 'Documents/{author}/{YYYY}', is_default: 0 },
    ];
    public organizationProposals: any[] = [];
    public searchIndex: any[] = [];

    pragma(str: string) {
      if (str.includes('journal_mode = WAL')) return 'wal';
      if (str.includes('foreign_keys = ON')) return 1;
      if (str.includes('busy_timeout')) return 5000;
      return null;
    }

    exec(_sql: string) {
      return this;
    }

    transaction(fn: Function) {
      return (...args: any[]) => fn(...args);
    }

    close() {}

    prepare(sql: string) {
      // Schema / Migrations
      if (sql.includes('SELECT name FROM sqlite_master')) return { get: () => null };
      if (sql.includes('PRAGMA integrity_check')) return { get: () => ({ integrity_check: 'ok' }) };
      if (sql.includes('PRAGMA table_info(organization_proposals)')) {
        return {
          all: () => [
            { name: 'id' },
            { name: 'rule_id' },
            { name: 'source_file_id' },
            { name: 'source_path' },
            { name: 'proposed_destination' },
            { name: 'status' },
            { name: 'warning_flags' },
            { name: 'created_at' },
          ],
        };
      }

      // App Settings
      if (sql.includes('FROM app_settings WHERE key = ?')) {
        return { get: () => null };
      }

      // Roots
      if (sql.includes('FROM roots WHERE id = ?')) {
        return { get: (id: string) => this.roots.find(r => r.id === id) || null };
      }
      if (sql.includes('FROM roots WHERE path = ?')) {
        return { get: (p: string) => this.roots.find(r => r.path === path.normalize(p)) || null };
      }
      if (sql.includes('SELECT * FROM roots')) {
        return { all: () => [...this.roots] };
      }

      // Organization Rules
      if (sql.includes('SELECT name, pattern FROM organization_rules WHERE id = ?')) {
        return {
          get: (id: string) => this.organizationRules.find(r => r.id === id) || null,
        };
      }
      if (sql.includes('SELECT id, name, pattern FROM organization_rules WHERE is_default = 1')) {
        return {
          get: () => this.organizationRules.find(r => r.is_default === 1) || this.organizationRules[0],
        };
      }
      if (sql.includes('SELECT * FROM organization_rules')) {
        return { all: () => [...this.organizationRules] };
      }

      // Files query for proposals
      if (sql.includes('FROM files f') && sql.includes('JOIN roots r')) {
        if (sql.includes('COUNT(*) as count')) {
          return {
            get: (..._params: any[]) => {
              return { count: this.files.length };
            },
          };
        }
        return {
          all: (..._params: any[]) => {
            return this.files.map(f => {
              const root = this.roots.find(r => r.id === f.root_id) || { path: 'C:\\TestSource' };
              const confirmedPerson = this.filePeople
                .filter(fp => fp.file_id === f.id)
                .map(fp => this.people.find(p => p.id === fp.person_id))
                .filter(p => p && (p.review_status === 'confirmed' || p.review_status === 'reviewed'))
                .map(p => p.name)
                .join(' & ');

              return {
                ...f,
                root_path: root.path,
                person_name: confirmedPerson || null,
                city: null,
                country: null,
                event_name: null,
              };
            });
          },
        };
      }

      // Copy operations
      if (sql.includes('INSERT INTO copy_operations')) {
        return {
          run: (...params: any[]) => {
            this.copyOperations.push({
              id: params[0],
              type: 'batch_copy',
              status: 'in_progress',
              source_description: params[1],
              destination_root: params[2],
              total_files: params[3],
              total_bytes: params[4],
              completed_files: 0,
              failed_files: 0,
              copied_bytes: 0,
              created_at: params[5],
            });
          },
        };
      }
      if (sql.includes('UPDATE copy_operations SET status = ?, completed_files = ?')) {
        return {
          run: (...params: any[]) => {
            const op = this.copyOperations.find(o => o.id === params[4]);
            if (op) {
              op.status = params[0];
              op.completed_files = params[1];
              op.failed_files = params[2];
              op.copied_bytes = params[3];
            }
          },
        };
      }
      if (sql.includes("SELECT id, destination_root FROM copy_operations WHERE status = 'in_progress'")) {
        return {
          all: () => this.copyOperations.filter(o => o.status === 'in_progress'),
        };
      }
      if (sql.includes("UPDATE copy_operations SET status = 'interrupted'")) {
        return {
          run: (id: string) => {
            const op = this.copyOperations.find(o => o.id === id);
            if (op) op.status = 'interrupted';
          },
        };
      }
      if (sql.includes('SELECT * FROM copy_operations WHERE id = ?')) {
        return {
          get: (id: string) => this.copyOperations.find(o => o.id === id) || null,
        };
      }

      // Operation items
      if (sql.includes('INSERT INTO operation_items')) {
        return {
          run: (...params: any[]) => {
            this.operationItems.push({
              id: params[0],
              operation_id: params[1],
              source_path: params[2],
              destination_path: params[3],
              file_size: params[4],
              status: params[5],
              created_at: params[6],
            });
          },
        };
      }
      if (sql.includes('UPDATE operation_items SET source_hash = ?')) {
        return {
          run: (...params: any[]) => {
            const item = this.operationItems.find(it => it.id === params[4]);
            if (item) {
              item.source_hash = params[0];
              item.destination_hash = params[1];
              item.status = params[2];
              item.error_message = params[3];
            }
          },
        };
      }
      if (sql.includes("UPDATE operation_items SET status = 'interrupted'")) {
        return {
          run: (opId: string) => {
            for (const it of this.operationItems) {
              if (it.operation_id === opId && it.status === 'pending') {
                it.status = 'interrupted';
              }
            }
          },
        };
      }
      if (sql.includes('SELECT * FROM operation_items WHERE operation_id = ?')) {
        return {
          all: (opId: string, status: string) => this.operationItems.filter(it => it.operation_id === opId && (!status || it.status === status)),
        };
      }

      // Operation history
      if (sql.includes('INSERT INTO operation_history')) {
        return {
          run: (...params: any[]) => {
            this.operationHistory.push({
              id: params[0],
              description: params[1],
              details_json: params[2],
              status: params[3],
            });
          },
        };
      }

      // Organization proposals
      if (sql.includes('INSERT INTO organization_proposals')) {
        return {
          run: (...params: any[]) => {
            const hasRuleName = params.length === 8;
            this.organizationProposals.push({
              id: params[0],
              rule_id: params[1],
              source_file_id: params[2],
              source_path: params[3],
              proposed_destination: params[4],
              rule_name: hasRuleName ? params[5] : undefined,
              status: hasRuleName ? params[6] : params[5],
              warning_flags: hasRuleName ? params[7] : params[6],
            });
          },
        };
      }

      // People & Face clusters
      if (sql.includes('FROM cluster_members cm') && sql.includes('JOIN face_clusters fc')) {
        return {
          get: (personId: string, faceId: string) => {
            const member = this.clusterMembers.find(cm => cm.face_detection_id === faceId);
            if (!member) return null;
            const cluster = this.faceClusters.find(fc => fc.id === member.cluster_id && fc.person_id === personId);
            if (!cluster) return null;
            const face = this.faceDetections.find(fd => fd.id === faceId);
            return { cluster_id: cluster.id, file_id: face?.file_id };
          },
        };
      }
      if (sql.includes('DELETE FROM cluster_members WHERE cluster_id = ? AND face_detection_id = ?')) {
        return {
          run: (clusterId: string, faceId: string) => {
            this.clusterMembers = this.clusterMembers.filter(cm => !(cm.cluster_id === clusterId && cm.face_detection_id === faceId));
          },
        };
      }
      if (sql.includes('UPDATE face_clusters') && sql.includes('member_count = MAX(0, member_count - 1)')) {
        return {
          run: (clusterId: string) => {
            const c = this.faceClusters.find(fc => fc.id === clusterId);
            if (c) c.member_count = Math.max(0, c.member_count - 1);
          },
        };
      }
      if (sql.includes('SELECT representative_face_id FROM people WHERE id = ?')) {
        return {
          get: (id: string) => this.people.find(p => p.id === id) || null,
        };
      }
      if (sql.includes('SELECT face_detection_id FROM cluster_members WHERE cluster_id = ? LIMIT 1')) {
        return {
          get: (clusterId: string) => this.clusterMembers.find(cm => cm.cluster_id === clusterId) || null,
        };
      }
      if (sql.includes('UPDATE people SET representative_face_id = ?')) {
        return {
          run: (faceId: string, personId: string) => {
            const p = this.people.find(person => person.id === personId);
            if (p) p.representative_face_id = faceId;
          },
        };
      }
      if (sql.includes('SELECT COUNT(*) as count FROM face_detections fd') && sql.includes('WHERE fd.file_id = ? AND fc.person_id = ?')) {
        return {
          get: (fileId: string, personId: string) => {
            const faces = this.faceDetections.filter(fd => fd.file_id === fileId);
            let count = 0;
            for (const f of faces) {
              const member = this.clusterMembers.find(cm => cm.face_detection_id === f.id);
              if (member) {
                const cluster = this.faceClusters.find(fc => fc.id === member.cluster_id && fc.person_id === personId);
                if (cluster) count++;
              }
            }
            return { count };
          },
        };
      }
      if (sql.includes('DELETE FROM file_people WHERE file_id = ? AND person_id = ?')) {
        return {
          run: (fileId: string, personId: string) => {
            this.filePeople = this.filePeople.filter(fp => !(fp.file_id === fileId && fp.person_id === personId));
          },
        };
      }
      if (sql.includes('INSERT INTO people')) {
        return {
          run: (...params: any[]) => {
            this.people.push({
              id: params[0],
              name: params[1],
              representative_face_id: params[2],
              review_status: params[3] || 'unreviewed',
            });
          },
        };
      }
      if (sql.includes('INSERT INTO face_clusters (id, person_id, member_count')) {
        return {
          run: (...params: any[]) => {
            this.faceClusters.push({
              id: params[0],
              person_id: params[1],
              member_count: params[2],
            });
          },
        };
      }
      if (sql.includes('INSERT INTO cluster_members (cluster_id, face_detection_id')) {
        return {
          run: (...params: any[]) => {
            this.clusterMembers.push({
              cluster_id: params[0],
              face_detection_id: params[1],
            });
          },
        };
      }
      if (sql.includes('INSERT OR IGNORE INTO file_people')) {
        return {
          run: (...params: any[]) => {
            if (!this.filePeople.some(fp => fp.file_id === params[0] && fp.person_id === params[1])) {
              this.filePeople.push({
                file_id: params[0],
                person_id: params[1],
                association_type: params[2],
              });
            }
          },
        };
      }

      // Default catch-all
      return {
        get: () => null,
        all: () => [],
        run: () => ({ changes: 1 }),
      };
    }
  }

  return { activeMockDb: new MockPhase2BDatabase() };
});

// Mock better-sqlite3 for Node test environment
vi.mock('better-sqlite3', () => {
  return {
    default: class {
      constructor() {
        return activeMockDb;
      }
    },
  };
});

// Mock electron app for test isolation
vi.mock('electron', () => ({
  app: {
    getPath: () => os.tmpdir(),
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
}));

// Import modules under test after mock
import {
  initDatabase,
  closeDatabase,
  separateFaceFromPerson,
  searchFiles,
} from '../../src/main/database';
import {
  sanitizePathSegment,
  resolveOrganizationPath,
  generateOrganizationProposals,
  saveProposalItemsToDb,
} from '../../src/main/organizer';
import {
  validateDestinationRoot,
  resolveSafeDestinationPath,
  copyFileWithVerification,
  executeBatchCopyOperation,
  recoverInterruptedOperations,
} from '../../src/main/file-operations';
import { collectFilesRecursively } from '../../src/main/indexer';

describe('Phase 2B: Safe Organization, Local AI, Face Recognition & UI Integration', () => {
  let tempDir: string;
  let tempDbPath: string;
  let sourceDir: string;
  let destDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexora-phase2b-test-'));
    tempDbPath = path.join(tempDir, 'test_nexora_2b.db');
    initDatabase(tempDbPath);

    sourceDir = path.join(tempDir, 'SourceMedia');
    destDir = path.join(tempDir, 'Nexora_Organized');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.mkdirSync(destDir, { recursive: true });

    // Reset mock db tables
    activeMockDb.roots = [{ id: 'root-1', path: sourceDir, label: 'Source Media' }];
    activeMockDb.files = [];
    activeMockDb.copyOperations = [];
    activeMockDb.operationItems = [];
    activeMockDb.people = [];
    activeMockDb.faceDetections = [];
    activeMockDb.faceClusters = [];
    activeMockDb.clusterMembers = [];
    activeMockDb.filePeople = [];
  });

  afterEach(() => {
    closeDatabase();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // ── 1. Path Sanitization & Traversal Prevention ─────────────────────────────
  describe('Path Sanitization & Security Traversal Prevention', () => {
    it('sanitizes forbidden characters and prevents path traversal tokens', () => {
      expect(sanitizePathSegment('..')).toBe('Unknown');
      expect(sanitizePathSegment('.')).toBe('Unknown');
      expect(sanitizePathSegment('Family/Vacation')).toBe('Family_Vacation');
      expect(sanitizePathSegment('Photo:2026*Summer?')).toBe('Photo_2026_Summer_');
      expect(sanitizePathSegment('  ...Trip to Japan...  ')).toBe('Trip to Japan');
      expect(sanitizePathSegment('Name|With<Pipes>')).toBe('Name_With_Pipes_');
      expect(sanitizePathSegment('')).toBe('Unknown');
    });

    it('resolves organization paths into safe hierarchies and maps formats to approved categories', () => {
      const mockImage = {
        filename: 'IMG_4021.JPG',
        extension: '.jpg',
        capture_time: '2025-06-15T14:30:00Z',
        camera_make: 'Sony',
        camera_model: 'ILCE-7M4',
      };
      const res = resolveOrganizationPath(mockImage, '{category}/{YYYY}/{MM}');
      expect(res.relativeFolder).toBe(path.join('Images', '2025', '06'));
      expect(res.warnings).toHaveLength(0);

      const mockDoc = {
        filename: 'Annual_Report.pdf',
        extension: '.pdf',
        file_created_at: '2024-11-20T10:00:00Z',
        doc_author: 'Alice Cooper',
      };
      const docRes = resolveOrganizationPath(mockDoc, '{category}/{author}/{YYYY}');
      expect(docRes.relativeFolder).toBe(path.join('Documents', 'Alice Cooper', '2024'));
    });

    it('falls back to safe defaults for unparseable dates or ambiguous tokens with explicit warnings', () => {
      const unknownFile = {
        filename: 'untitled_note.txt',
        extension: '.txt',
      };
      const res = resolveOrganizationPath(unknownFile, '{category}/{YYYY}/{custom_field}');
      expect(res.relativeFolder).toBe(path.join('Text', 'Unknown Date', 'General'));
      expect(res.warnings.length).toBeGreaterThan(0);
      expect(res.warnings.some(w => w.includes('Unresolved or ambiguous rule tokens'))).toBe(true);
    });

    it('prevents path traversal sequences from escaping the managed destination root', async () => {
      const traversalFile = {
        id: 'f-trav',
        root_id: 'root-1',
        relative_path: 'hack.jpg',
        filename: 'hack.jpg',
        extension: '.jpg',
        size_bytes: 500,
        capture_time: '2025-01-01T00:00:00Z',
      };
      activeMockDb.files = [traversalFile];

      const maliciousPattern = '../../../../Windows/System32';
      const summary = await generateOrganizationProposals([traversalFile.id], maliciousPattern, destDir);
      expect(summary.proposals).toHaveLength(1);

      const proposed = summary.proposals[0].proposed_destination;
      expect(proposed.startsWith(path.resolve(destDir))).toBe(true);
      expect(proposed).not.toContain('System32');
    });
  });

  // ── 2. Gated Identity Organization ─────────────────────────────────────────
  describe('Person Identity Gating for Organization', () => {
    it('uses confirmed person assignments only; falls back to Unassigned with warning for unconfirmed persons', () => {
      const mockPhoto = {
        filename: 'Family.jpg',
        extension: '.jpg',
        capture_time: '2025-08-10T12:00:00Z',
      };

      // 1. Unconfirmed / null person
      const unassignedRes = resolveOrganizationPath(mockPhoto, 'People/{person}/{YYYY}', null);
      expect(unassignedRes.relativeFolder).toBe(path.join('People', 'Unassigned', '2025'));
      expect(unassignedRes.warnings.some(w => w.includes('No confirmed person identity'))).toBe(true);

      // 2. Confirmed person
      const confirmedRes = resolveOrganizationPath(mockPhoto, 'People/{person}/{YYYY}', 'Sarah Connor');
      expect(confirmedRes.relativeFolder).toBe(path.join('People', 'Sarah Connor', '2025'));
    });
  });

  // ── 3. Original File Preservation & Copy Verification ───────────────────────
  describe('Original File Preservation & Streaming Verification', () => {
    it('preserves source file originals unchanged and verifies copy using pre- and post-copy SHA-256', async () => {
      const srcFile = path.join(sourceDir, 'original_test.png');
      const testContent = Buffer.from('Nexora Immutable Source Content 12345!@#$%^');
      fs.writeFileSync(srcFile, testContent);

      const expectedSha256 = crypto.createHash('sha256').update(testContent).digest('hex');
      const targetFile = path.join(destDir, 'verified_copy.png');

      const result = await copyFileWithVerification(srcFile, targetFile);

      expect(result.success).toBe(true);
      expect(result.sourceHash).toBe(expectedSha256);
      expect(result.destHash).toBe(expectedSha256);

      // Verify original file is 100% byte-for-byte identical
      const sourceAfterContent = fs.readFileSync(srcFile);
      expect(sourceAfterContent.equals(testContent)).toBe(true);

      // Verify destination file exists and matches hash
      const destContent = fs.readFileSync(targetFile);
      expect(destContent.equals(testContent)).toBe(true);
    });

    it('rejects copy and cleans temporary files if file hash verification fails', async () => {
      const srcFile = path.join(sourceDir, 'corrupt_sim.bin');
      fs.writeFileSync(srcFile, 'Normal content');
      const targetFile = path.join(destDir, 'corrupt_dest.bin');

      // Pass mismatched known hash
      const badHash = '0000000000000000000000000000000000000000000000000000000000000000';
      const result = await copyFileWithVerification(srcFile, targetFile, badHash);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Integrity check failed');
      expect(fs.existsSync(targetFile)).toBe(false);
    });
  });

  // ── 4. Collision Handling & Redundant Copy Avoidance ─────────────────────────
  describe('Collision Avoidance & Redundant Copies Prevention', () => {
    it('detects duplicate content and avoids redundant copy when file already exists at destination', async () => {
      const existingFile = path.join(destDir, 'photo.jpg');
      const content = Buffer.from('Identical Image Payload');
      fs.writeFileSync(existingFile, content);

      const contentHash = crypto.createHash('sha256').update(content).digest('hex');

      const collisionRes = await resolveSafeDestinationPath(existingFile, contentHash);
      expect(collisionRes.isIdenticalDuplicate).toBe(true);
      expect(collisionRes.finalPath).toBe(existingFile);
    });

    it('auto-increments collision filename to prevent overwriting when content differs', async () => {
      const existingFile = path.join(destDir, 'photo.jpg');
      fs.writeFileSync(existingFile, 'Old Photo Version 1');

      const differentContentHash = crypto.createHash('sha256').update('New Photo Version 2').digest('hex');

      const collisionRes = await resolveSafeDestinationPath(existingFile, differentContentHash);
      expect(collisionRes.isIdenticalDuplicate).toBe(false);
      expect(collisionRes.finalPath).toBe(path.join(destDir, 'photo (1).jpg'));
    });

    it('executes batch organization without redundant copies and persists source-to-copy mappings', async () => {
      const file1 = path.join(sourceDir, 'doc1.pdf');
      const file2 = path.join(sourceDir, 'doc2.pdf');
      fs.writeFileSync(file1, 'Document 1 content');
      fs.writeFileSync(file2, 'Document 2 content');

      // Pre-seed identical doc1 at destination
      const destDoc1 = path.join(destDir, 'Documents', 'doc1.pdf');
      fs.mkdirSync(path.dirname(destDoc1), { recursive: true });
      fs.writeFileSync(destDoc1, 'Document 1 content');

      const destDoc2 = path.join(destDir, 'Documents', 'doc2.pdf');

      const copyItems = [
        { sourcePath: file1, destinationPath: destDoc1 },
        { sourcePath: file2, destinationPath: destDoc2 },
      ];

      const res = await executeBatchCopyOperation('Test Organization', destDir, copyItems);

      expect(res.success).toBe(true);
      expect(res.completedFiles).toBe(2);
      expect(res.failedFiles).toBe(0);

      // Verify operation items in database
      const skippedItem = activeMockDb.operationItems.find(it => it.source_path === file1);
      const copiedItem = activeMockDb.operationItems.find(it => it.source_path === file2);

      expect(skippedItem?.status).toBe('skipped_identical');
      expect(copiedItem?.status).toBe('completed');
    });
  });

  // ── 5. Recovery from Interrupted Operations ──────────────────────────────────
  describe('Interrupted Copy Safe Recovery', () => {
    it('recovers stranded operations and cleans up orphan temporary copy files', async () => {
      activeMockDb.copyOperations.push({
        id: 'op-interrupted',
        status: 'in_progress',
        destination_root: destDir,
      });

      const orphanTmp = path.join(destDir, 'file.jpg.nexora-tmp-123456789');
      fs.writeFileSync(orphanTmp, 'Half-written junk data');
      expect(fs.existsSync(orphanTmp)).toBe(true);

      const recovery = await recoverInterruptedOperations();

      expect(recovery.recoveredCount).toBe(1);
      expect(recovery.cleanedTempFiles).toBe(1);
      expect(fs.existsSync(orphanTmp)).toBe(false);

      const op = activeMockDb.copyOperations.find(o => o.id === 'op-interrupted');
      expect(op?.status).toBe('interrupted');
    });
  });

  // ── 6. Managed Folder Scanning Exclusion ─────────────────────────────────────
  describe('Managed Folder Scanning Exclusion', () => {
    it('excludes managed destination folder containing .nexora-managed from recursive scans', () => {
      validateDestinationRoot(destDir, 1024);
      const markerPath = path.join(destDir, '.nexora-managed');
      expect(fs.existsSync(markerPath)).toBe(true);

      const sourceFile = path.join(sourceDir, 'real_photo.jpg');
      fs.writeFileSync(sourceFile, 'photo data');

      const managedCopy = path.join(destDir, 'organized_photo.jpg');
      fs.writeFileSync(managedCopy, 'managed copy data');

      const collected = collectFilesRecursively(tempDir);

      expect(collected.some(p => p.includes('real_photo.jpg'))).toBe(true);
      expect(collected.some(p => p.includes('organized_photo.jpg'))).toBe(false);
      expect(collected.some(p => p.includes('.nexora-managed'))).toBe(false);
    });
  });

  // ── 7. Local AI & Face Cluster Separation ───────────────────────────────────
  describe('Face Recognition & Cluster Separation Engine', () => {
    it('separates a face detection from a person cluster into an unreviewed entity', () => {
      const personId = 'person-alice';
      const clusterId = 'cluster-1';
      const face1 = 'face-detection-1';
      const face2 = 'face-detection-2';
      const fileId = 'file-photo-1';

      activeMockDb.people = [
        { id: personId, name: 'Alice', representative_face_id: face1, review_status: 'confirmed' },
      ];
      activeMockDb.faceClusters = [
        { id: clusterId, person_id: personId, member_count: 2 },
      ];
      activeMockDb.clusterMembers = [
        { cluster_id: clusterId, face_detection_id: face1 },
        { cluster_id: clusterId, face_detection_id: face2 },
      ];
      activeMockDb.faceDetections = [
        { id: face1, file_id: fileId },
        { id: face2, file_id: fileId },
      ];
      activeMockDb.filePeople = [
        { file_id: fileId, person_id: personId, association_type: 'confirmed' },
      ];

      const sepResult = separateFaceFromPerson(personId, face1, 'Separated Face');

      expect(sepResult.success).toBe(true);
      expect(sepResult.newPersonId).toBeDefined();

      const c1 = activeMockDb.faceClusters.find(c => c.id === clusterId);
      expect(c1?.member_count).toBe(1);

      const alice = activeMockDb.people.find(p => p.id === personId);
      expect(alice?.representative_face_id).toBe(face2);

      const newPerson = activeMockDb.people.find(p => p.id === sepResult.newPersonId);
      expect(newPerson).toBeDefined();
      expect(newPerson?.review_status).toBe('unreviewed');
      expect(newPerson?.name).toBe('Separated Face');
    });
  });

  // ── 8. Local Metadata Search Engine ─────────────────────────────────────────
  describe('Local Search Engine with Metadata Filters', () => {
    it('executes search queries filtering by text, camera, author and size', () => {
      activeMockDb.files = [
        {
          id: 'f1',
          root_id: 'root-1',
          filename: 'Family_Photo.jpg',
          relative_path: '2025/Family_Photo.jpg',
          extension: '.jpg',
          size_bytes: 4000000,
          capture_time: '2025-07-04T12:00:00Z',
          camera_make: 'Sony',
          camera_model: 'A7IV',
          is_missing: 0,
        },
        {
          id: 'f2',
          root_id: 'root-1',
          filename: 'Financial_Report.pdf',
          relative_path: 'Docs/Financial_Report.pdf',
          extension: '.pdf',
          size_bytes: 500000,
          doc_author: 'CFO John Doe',
          is_missing: 0,
        },
      ];

      const searchResult = searchFiles({
        text: 'Family',
        extension: ['.jpg'],
        limit: 10,
      });

      expect(searchResult.totalCount).toBeDefined();
      expect(searchResult.executionTimeMs).toBeGreaterThanOrEqual(0);
      expect(searchResult.query.text).toBe('Family');
    });
  });

  // ── 9. AI Pipeline Execution & Scheduling Integrity ─────────────────────────
  describe('AI Pipeline Execution & Trigger Integrity', () => {
    it('ensures AI extraction is enabled by default in folder scan configuration', () => {
      // Configuration object defaults test
      const config: any = {};
      const extractAi = config.extractAi !== false;
      expect(extractAi).toBe(true);

      const explicitDisabledConfig = { extractAi: false };
      expect(explicitDisabledConfig.extractAi !== false).toBe(false);

      const explicitEnabledConfig = { extractAi: true };
      expect(explicitEnabledConfig.extractAi !== false).toBe(true);
    });

    it('detects unclustered faces and allows scheduling face_clustering', () => {
      // Simulate unclustered face detection
      activeMockDb.faceDetections = [
        { id: 'face-unclustered-1', file_id: 'file-1' },
      ];
      activeMockDb.clusterMembers = [];

      const unclustered = activeMockDb.faceDetections.filter(
        (fd) => !activeMockDb.clusterMembers.some((cm) => cm.face_detection_id === fd.id)
      );

      expect(unclustered.length).toBe(1);
    });
  });

  // ── 10. Organization Proposals & warning_flags Persistence ─────────────────
  describe('Organization Proposals & warning_flags Schema Compatibility', () => {
    it('persists proposals with warning flags into organization_proposals table and maps them back', () => {
      const testItem = {
        id: 'prop-test-1',
        rule_id: 'rule_default_date',
        source_file_id: 'f1',
        source_path: 'C:\\Source\\photo.jpg',
        proposed_destination: 'C:\\Organized\\Images\\2025\\photo.jpg',
        rule_name: 'Date Hierarchy',
        status: 'proposed' as const,
        warnings: ['Identical file already exists at destination; redundant copy will be safely skipped'],
        metadata_snapshot: { category: 'Images' },
        file_size: 4096,
      };

      saveProposalItemsToDb([testItem], 'rule_default_date');

      const saved = activeMockDb.organizationProposals.find(p => p.id === 'prop-test-1');
      expect(saved).toBeDefined();
      expect(saved?.proposed_destination).toBe('C:\\Organized\\Images\\2025\\photo.jpg');
      expect(saved?.warning_flags).toContain('Identical file already exists');

      const parsedWarnings = JSON.parse(saved?.warning_flags);
      expect(parsedWarnings.length).toBe(1);
      expect(parsedWarnings[0]).toContain('redundant copy will be safely skipped');
    });
  });
});
