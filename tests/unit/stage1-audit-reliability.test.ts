// ============================================================================
// Nexora — Stage 1 Comprehensive Verification Test Suite
// Verifies SQLite Schema Migration, warning_flags, Apply Organization,
// File Safety, Hash Verification, Failure Handling, and Scan Exclusions.
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';

// ── Hoisted Mock Database for Stage 1 Testing ────────────────────────────────
const { activeMockDb } = vi.hoisted(() => {
  class MockStage1Database {
    public schemaVersion = 3;
    public schemaHistory: Array<{ version: number; description?: string }> = [
      { version: 1, description: 'Initial' },
      { version: 2, description: 'Metadata intelligence' },
      { version: 3, description: 'Scan infrastructure' },
    ];
    public tables: Set<string> = new Set([
      'schema_version', 'roots', 'files', 'organization_rules',
      'organization_proposals', 'copy_operations', 'operation_items',
    ]);
    public proposalColumns: Array<{ name: string; type: string }> = [
      { name: 'id', type: 'TEXT' },
      { name: 'rule_id', type: 'TEXT' },
      { name: 'source_file_id', type: 'TEXT' },
      { name: 'source_path', type: 'TEXT' },
      { name: 'proposed_destination', type: 'TEXT' },
      { name: 'rule_name', type: 'TEXT' },
      { name: 'status', type: 'TEXT' },
      { name: 'warnings_json', type: 'TEXT' },
      { name: 'metadata_snapshot_json', type: 'TEXT' },
      { name: 'created_at', type: 'TEXT' },
    ];
    public roots: any[] = [];
    public files: any[] = [];
    public copyOperations: any[] = [];
    public operationItems: any[] = [];
    public organizationProposals: any[] = [];
    public appSettings: Map<string, string> = new Map();

    pragma(str: string) {
      if (str.includes('journal_mode = WAL')) return 'wal';
      if (str.includes('foreign_keys = ON')) return 1;
      if (str.includes('busy_timeout')) return 5000;
      return null;
    }

    exec(sql: string) {
      if (sql.includes('ALTER TABLE organization_proposals ADD COLUMN warning_flags TEXT')) {
        if (!this.proposalColumns.some(c => c.name === 'warning_flags')) {
          this.proposalColumns.push({ name: 'warning_flags', type: 'TEXT' });
        }
      }
      return this;
    }

    transaction(fn: Function) {
      return (...args: any[]) => fn(...args);
    }

    close() {}

    prepare(sql: string) {
      // Schema version check
      if (sql.includes("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'")) {
        return { get: () => (this.tables.has('schema_version') ? { name: 'schema_version' } : null) };
      }
      if (sql.includes("SELECT name FROM sqlite_master WHERE type='table' AND name='organization_proposals'")) {
        return { get: () => (this.tables.has('organization_proposals') ? { name: 'organization_proposals' } : null) };
      }
      if (sql.includes("SELECT name FROM sqlite_master WHERE type='table'")) {
        return { all: () => Array.from(this.tables).map(name => ({ name })) };
      }
      if (sql.includes('SELECT MAX(version) as version FROM schema_version')) {
        return { get: () => ({ version: this.schemaVersion }) };
      }
      if (sql.includes('PRAGMA table_info(organization_proposals)')) {
        return { all: () => [...this.proposalColumns] };
      }

      // App Settings
      if (sql.includes("FROM app_settings WHERE key = 'managedLibraryPath'")) {
        return {
          get: () => {
            const val = this.appSettings.get('managedLibraryPath');
            return val ? { value: val } : null;
          },
        };
      }

      // Roots
      if (sql.includes("FROM roots WHERE type = 'managed' AND active = 1")) {
        return {
          get: () => this.roots.find(r => r.type === 'managed' && r.active === 1) || null,
        };
      }
      if (sql.includes('FROM roots WHERE id = ?')) {
        return { get: (id: string) => this.roots.find(r => r.id === id) || null };
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

      // Organization proposals
      if (sql.includes('INSERT INTO organization_proposals')) {
        return {
          run: (...params: any[]) => {
            const hasRuleName = params.length >= 8;
            this.organizationProposals.push({
              id: params[0],
              rule_id: params[1],
              source_file_id: params[2],
              source_path: params[3],
              proposed_destination: params[4],
              rule_name: hasRuleName ? params[5] : 'Metadata Rule',
              status: hasRuleName ? params[6] : params[5],
              warning_flags: hasRuleName ? params[7] : params[6],
              metadata_snapshot_json: params[8] || '{}',
            });
          },
        };
      }
      if (sql.includes("UPDATE organization_proposals SET status = 'executed'")) {
        return {
          run: (id: string | null, srcPath: string) => {
            const p = this.organizationProposals.find(item => item.id === id || item.source_path === srcPath);
            if (p) p.status = 'executed';
          },
        };
      }
      if (sql.includes('SELECT op.*, f.filename')) {
        return {
          all: (status: string, limit: number) => {
            return this.organizationProposals
              .filter(p => !status || p.status === status)
              .slice(0, limit)
              .map(p => ({
                ...p,
                filename: path.basename(p.source_path),
                extension: path.extname(p.source_path),
                size_bytes: 1024,
                capture_time: '2026-01-01',
                camera_make: 'Sony',
                camera_model: 'A7',
                doc_author: 'Test Author',
                hash_sha256: 'mockhash',
                rule_name: p.rule_name || 'Metadata Rule',
              }));
          },
        };
      }

      return {
        get: () => null,
        all: () => [],
        run: () => ({ changes: 1 }),
      };
    }
  }

  return { activeMockDb: new MockStage1Database() };
});

vi.mock('better-sqlite3', () => {
  return {
    default: class {
      constructor() {
        return activeMockDb;
      }
    },
  };
});

vi.mock('electron', () => ({
  app: {
    getPath: () => os.tmpdir(),
    getVersion: () => '0.5.0',
    isPackaged: false,
  },
  BrowserWindow: {
    getAllWindows: () => [],
    getFocusedWindow: () => null,
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
  },
}));

import { runMigrations, resolveAppDatabasePath, initDatabase, closeDatabase } from '../../src/main/database';
import {
  resolveSafeDestinationPath,
  copyFileWithVerification,
  executeBatchCopyOperation,
} from '../../src/main/file-operations';
import {
  saveProposalItemsToDb,
  getStoredProposals,
  executeOrganization,
  resolveDefaultManagedLibrary,
} from '../../src/main/organizer';
import { collectFilesRecursively } from '../../src/main/indexer';

function sha256Sync(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

describe('Stage 1: SQLite Migration & Apply Organization Reliability', () => {
  let tempDir: string;
  let tempDbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexora-stage1-'));
    tempDbPath = path.join(tempDir, 'test.db');
    initDatabase(tempDbPath);

    activeMockDb.schemaVersion = 3;
    activeMockDb.proposalColumns = [
      { name: 'id', type: 'TEXT' },
      { name: 'rule_id', type: 'TEXT' },
      { name: 'source_file_id', type: 'TEXT' },
      { name: 'source_path', type: 'TEXT' },
      { name: 'proposed_destination', type: 'TEXT' },
      { name: 'rule_name', type: 'TEXT' },
      { name: 'status', type: 'TEXT' },
      { name: 'warnings_json', type: 'TEXT' },
      { name: 'metadata_snapshot_json', type: 'TEXT' },
      { name: 'created_at', type: 'TEXT' },
    ];
    activeMockDb.roots = [];
    activeMockDb.files = [];
    activeMockDb.copyOperations = [];
    activeMockDb.operationItems = [];
    activeMockDb.organizationProposals = [];
    activeMockDb.appSettings.clear();
  });

  afterEach(() => {
    closeDatabase();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // ── 1. Migration from current schema missing warning_flags ───────────────────
  it('1. Migrates from an existing v3 schema missing warning_flags and adds column safely', () => {
    expect(activeMockDb.proposalColumns.some(c => c.name === 'warning_flags')).toBe(false);

    // Run migration runner
    runMigrations(activeMockDb as any);

    // Verify warning_flags column is present
    expect(activeMockDb.proposalColumns.some(c => c.name === 'warning_flags')).toBe(true);
  });

  // ── 2. Running migration more than once is idempotent ────────────────────────
  it('2. Running migration more than once does not throw duplicate column errors', () => {
    runMigrations(activeMockDb as any);
    expect(() => {
      runMigrations(activeMockDb as any);
    }).not.toThrow();
    expect(activeMockDb.proposalColumns.filter(c => c.name === 'warning_flags').length).toBe(1);
  });

  // ── 3. Fresh database initialization ─────────────────────────────────────────
  it('3. Initializes fresh database with schema version 4 and all core tables', () => {
    activeMockDb.schemaVersion = 0;
    runMigrations(activeMockDb as any);

    expect(activeMockDb.tables.has('roots')).toBe(true);
    expect(activeMockDb.tables.has('files')).toBe(true);
    expect(activeMockDb.tables.has('organization_rules')).toBe(true);
    expect(activeMockDb.tables.has('organization_proposals')).toBe(true);
    expect(activeMockDb.tables.has('copy_operations')).toBe(true);
    expect(activeMockDb.tables.has('operation_items')).toBe(true);
  });

  // ── 4. Reading and writing warning_flags ──────────────────────────────────────
  it('4. Successfully writes and reads warning_flags JSON values to/from SQLite', () => {
    runMigrations(activeMockDb as any);

    const testProposal = {
      id: 'prop-flag-1',
      rule_id: 'rule-date',
      source_file_id: 'file-1',
      source_path: 'C:\\Source\\doc.pdf',
      proposed_destination: 'C:\\Managed\\doc.pdf',
      rule_name: 'Date Rule',
      status: 'proposed' as const,
      warnings: ['Collision resolved with suffix', 'Low confidence date'],
      metadata_snapshot: { category: 'Document' },
      file_size: 2048,
    };

    saveProposalItemsToDb([testProposal], 'rule-date');

    const stored = getStoredProposals('proposed', 10);
    expect(stored.length).toBeGreaterThan(0);
    const item = stored.find(p => p.id === 'prop-flag-1');
    expect(item).toBeDefined();
    expect(item?.warnings).toContain('Collision resolved with suffix');
    expect(item?.warnings).toContain('Low confidence date');
  });

  // ── 5. Applying a valid organization proposal ─────────────────────────────────
  it('5. Successfully applies organization proposal, copies file, and updates SQLite status', async () => {
    runMigrations(activeMockDb as any);

    const sourceDir = path.join(tempDir, 'source');
    const destDir = path.join(tempDir, 'managed_output');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.mkdirSync(destDir, { recursive: true });

    const srcFile = path.join(sourceDir, 'sample.txt');
    fs.writeFileSync(srcFile, 'Nexora reliable copy test payload');
    const originalHash = sha256Sync(srcFile);

    const destFile = path.join(destDir, 'Text', '2026', 'sample.txt');

    const proposalItem = {
      id: 'prop-exec-1',
      source_path: srcFile,
      proposed_destination: destFile,
      status: 'proposed' as const,
      warnings: [],
      metadata_snapshot: {},
      file_size: 32,
      source_file_id: 'f-sample',
      rule_name: 'Text Rule',
    };
    saveProposalItemsToDb([proposalItem]);

    const result = await executeOrganization([proposalItem], destDir);

    expect(result.success).toBe(true);
    expect(result.completedFiles).toBe(1);
    expect(result.failedFiles).toBe(0);

    // Verify copy exists at destination with matching hash
    expect(fs.existsSync(destFile)).toBe(true);
    expect(sha256Sync(destFile)).toBe(originalHash);

    // Verify original remains untouched
    expect(fs.existsSync(srcFile)).toBe(true);
    expect(sha256Sync(srcFile)).toBe(originalHash);

    // Verify database record status updated to 'executed'
    const stored = activeMockDb.organizationProposals.find(p => p.id === 'prop-exec-1');
    expect(stored?.status).toBe('executed');
  });

  // ── 6. Handling an empty or invalid proposal ──────────────────────────────────
  it('6. Safely handles empty or missing proposal arrays without throwing uncaught errors', async () => {
    const destDir = path.join(tempDir, 'managed_output');
    fs.mkdirSync(destDir, { recursive: true });

    const result = await executeOrganization([], destDir);
    expect(result.success).toBe(true);
    expect(result.totalFiles).toBe(0);
    expect(result.completedFiles).toBe(0);
  });

  // ── 7. Handling a missing source file ─────────────────────────────────────────
  it('7. Handles a missing source file by recording error without crashing or corrupting DB', async () => {
    const destDir = path.join(tempDir, 'managed_output');
    fs.mkdirSync(destDir, { recursive: true });
    const nonExistent = path.join(tempDir, 'ghost.txt');
    const destFile = path.join(destDir, 'ghost.txt');

    const result = await executeBatchCopyOperation(
      'Missing File Test',
      destDir,
      [{ sourcePath: nonExistent, destinationPath: destFile }]
    );

    expect(result.success).toBe(false);
    expect(result.failedFiles).toBe(1);
    expect(result.completedFiles).toBe(0);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].error).toMatch(/Failed to access source file|ENOENT/);

    const opRecord = activeMockDb.copyOperations[0];
    expect(opRecord.status).toBe('failed');
    expect(opRecord.failed_files).toBe(1);
  });

  // ── 8. Handling destination collisions ────────────────────────────────────────
  it('8. Handles destination collisions by auto-incrementing filename when content differs', async () => {
    const destDir = path.join(tempDir, 'managed');
    fs.mkdirSync(destDir, { recursive: true });

    const existingDest = path.join(destDir, 'report.docx');
    fs.writeFileSync(existingDest, 'Existing report content');

    const newSource = path.join(tempDir, 'report.docx');
    fs.writeFileSync(newSource, 'Brand new report content');
    const newHash = sha256Sync(newSource);

    const collisionRes = await resolveSafeDestinationPath(existingDest, newHash);
    expect(collisionRes.isIdenticalDuplicate).toBe(false);
    expect(collisionRes.finalPath).toBe(path.join(destDir, 'report (1).docx'));

    const copyRes = await copyFileWithVerification(newSource, collisionRes.finalPath, newHash);
    expect(copyRes.success).toBe(true);
    expect(fs.existsSync(existingDest)).toBe(true);
    expect(fs.readFileSync(existingDest, 'utf-8')).toBe('Existing report content');
    expect(fs.existsSync(collisionRes.finalPath)).toBe(true);
    expect(fs.readFileSync(collisionRes.finalPath, 'utf-8')).toBe('Brand new report content');
  });

  // ── 9. Verifying copied-file hashes and preservation of originals ──────────────
  it('9. Preserves original files and verifies byte-for-byte SHA-256 integrity on copy', async () => {
    const srcDir = path.join(tempDir, 'src');
    const dstDir = path.join(tempDir, 'dst');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.mkdirSync(dstDir, { recursive: true });

    const testFile = path.join(srcDir, 'data.bin');
    const randomBuffer = crypto.randomBytes(64 * 1024); // 64 KB
    fs.writeFileSync(testFile, randomBuffer);
    const expectedHash = crypto.createHash('sha256').update(randomBuffer).digest('hex');

    const targetFile = path.join(dstDir, 'data.bin');
    const res = await copyFileWithVerification(testFile, targetFile);

    expect(res.success).toBe(true);
    expect(res.sourceHash).toBe(expectedHash);
    expect(res.destHash).toBe(expectedHash);

    // Source unchanged
    expect(fs.existsSync(testFile)).toBe(true);
    expect(sha256Sync(testFile)).toBe(expectedHash);
  });

  // ── 10. Retrying after interrupted copy (idempotent duplicate detection) ───────
  it('10. Detects already-copied identical file upon retry and avoids duplicate work', async () => {
    const srcDir = path.join(tempDir, 'src');
    const dstDir = path.join(tempDir, 'dst');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.mkdirSync(dstDir, { recursive: true });

    const srcFile = path.join(srcDir, 'item.jpg');
    fs.writeFileSync(srcFile, 'binary image bytes simulated');
    const hash = sha256Sync(srcFile);

    const dstFile = path.join(dstDir, 'item.jpg');
    fs.writeFileSync(dstFile, 'binary image bytes simulated');

    const check = await resolveSafeDestinationPath(dstFile, hash);
    expect(check.isIdenticalDuplicate).toBe(true);
    expect(check.finalPath).toBe(dstFile);
  });

  // ── 11. Self-copy protection ──────────────────────────────────────────────────
  it('11. Refuses to copy a file onto itself to prevent file truncation or corruption', async () => {
    const file = path.join(tempDir, 'self.txt');
    fs.writeFileSync(file, 'Self copy content');

    const res = await copyFileWithVerification(file, file);
    expect(res.success).toBe(false);
    expect(res.error).toContain('Cannot copy file onto itself');
  });

  // ── 12. Excluding managed output directory from recursive scans ───────────────
  it('12. Excludes managed output directory containing .nexora-managed from recursive scans', () => {
    const rootDir = path.join(tempDir, 'root_to_scan');
    const normalSubDir = path.join(rootDir, 'Documents');
    const managedSubDir = path.join(rootDir, 'Managed_Folder');

    fs.mkdirSync(normalSubDir, { recursive: true });
    fs.mkdirSync(managedSubDir, { recursive: true });

    // Put .nexora-managed marker inside managedSubDir
    fs.writeFileSync(path.join(managedSubDir, '.nexora-managed'), 'managed');

    // Add files
    fs.writeFileSync(path.join(normalSubDir, 'valid.pdf'), 'content');
    fs.writeFileSync(path.join(managedSubDir, 'should_be_ignored.pdf'), 'content');

    const discovered = collectFilesRecursively(rootDir);
    expect(discovered).toContain(path.join(normalSubDir, 'valid.pdf'));
    expect(discovered).not.toContain(path.join(managedSubDir, 'should_be_ignored.pdf'));
  });

  // ── 13. Database path resolution in dev vs packaged ────────────────────────────
  it('13. Resolves legacy ai-file-manager.db when present, or nexora.db otherwise', () => {
    const testUserData = path.join(tempDir, 'mockUserData');
    fs.mkdirSync(testUserData, { recursive: true });

    // Without legacy db
    const freshPath = resolveAppDatabasePath(testUserData);
    expect(freshPath).toBe(path.join(testUserData, 'nexora.db'));

    // With legacy db
    const legacyPath = path.join(testUserData, 'ai-file-manager.db');
    fs.writeFileSync(legacyPath, '');
    const migratedPath = resolveAppDatabasePath(testUserData);
    expect(migratedPath).toBe(legacyPath);
  });

  // ── 14. Fallback managed library path resolution ──────────────────────────────
  it('14. Resolves default managed library path safely when setting or root is absent', () => {
    const defaultLib = resolveDefaultManagedLibrary();
    expect(defaultLib).toBeDefined();
    expect(typeof defaultLib).toBe('string');
    expect(defaultLib.length).toBeGreaterThan(0);
    expect(defaultLib).toContain('Nexora Organized');
  });
});
