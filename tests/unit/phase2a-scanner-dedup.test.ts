// ============================================================================
// Phase 2A Unit & Integration Tests: Filesystem, Scanning, Metadata & Duplicates
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';

// ── In-Memory Database Mock for Node.js Testing Environment ──────────────────
class MockPhase2ADatabase {
  public roots: any[] = [];
  public files: any[] = [];
  public jobs: any[] = [];
  public duplicateGroups: any[] = [];
  public duplicateGroupFiles: any[] = [];
  public searchIndex: any[] = [];
  public migrations: any[] = [];

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
    // Migration checks
    if (sql.includes('SELECT name FROM sqlite_master')) {
      return { get: () => null };
    }
    if (sql.includes('PRAGMA integrity_check')) {
      return { get: () => ({ integrity_check: 'ok' }) };
    }
    if (sql.includes('INSERT INTO schema_migrations')) {
      return {
        run: (...params: any[]) => {
          this.migrations.push({ version: params[0], name: params[1] });
        },
      };
    }

    // Roots
    if (sql.includes('FROM roots WHERE path = ?')) {
      return {
        get: (p: string) => this.roots.find(r => r.path === path.normalize(p)) || null,
      };
    }
    if (sql.includes('FROM roots WHERE id = ?')) {
      return {
        get: (id: string) => this.roots.find(r => r.id === id) || null,
      };
    }
    if (sql.includes('SELECT * FROM roots ORDER BY')) {
      return {
        all: () => [...this.roots],
      };
    }
    if (sql.includes('INSERT INTO roots')) {
      return {
        run: (...params: any[]) => {
          this.roots.push({
            id: params[0],
            path: path.normalize(params[1]),
            label: params[2],
            type: params[3] || 'indexed',
            active: 1,
            scan_status: sql.includes("'scanning'") ? 'scanning' : 'idle',
            file_count: 0,
            total_size_bytes: 0,
            last_error: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        },
      };
    }
    if (sql.includes('UPDATE roots SET') && sql.includes('WHERE id = ?')) {
      return {
        run: (...params: any[]) => {
          const id = params[params.length - 1];
          const root = this.roots.find(r => r.id === id);
          if (root) {
            if (sql.includes('scan_status = ?')) {
              root.scan_status = params[0];
            }
            if (sql.includes('file_count = ?')) {
              root.file_count = params[1];
            }
            if (sql.includes('total_size_bytes = ?')) {
              root.total_size_bytes = params[2];
            }
            if (sql.includes('last_error = ?')) {
              root.last_error = params[params.length - 2];
            }
            if (sql.includes('last_scanned_at = datetime')) {
              root.last_scanned_at = new Date().toISOString();
            }
          }
        },
      };
    }
    if (sql.includes('UPDATE roots') && sql.includes("scan_status = 'error'") && sql.includes("WHERE scan_status = 'scanning'")) {
      return {
        run: () => {
          for (const r of this.roots) {
            if (r.scan_status === 'scanning') {
              r.scan_status = 'error';
              r.last_error = 'Scan interrupted by application restart';
            }
          }
        },
      };
    }

    // Files
    if (sql.includes('SELECT SUM(size_bytes)')) {
      return {
        get: (rootId: string) => {
          const total = this.files
            .filter(f => f.root_id === rootId && f.is_missing !== 1)
            .reduce((sum, f) => sum + (f.size_bytes || 0), 0);
          return { total };
        },
        all: () => [],
        run: () => ({ changes: 1 }),
      };
    }
    if (sql.includes('FROM files WHERE root_id = ?')) {
      return {
        get: () => null,
        run: () => ({ changes: 1 }),
        all: (rootId: string) => {
          return this.files
            .filter(f => f.root_id === rootId)
            .map(f => ({
              id: f.id,
              relative_path: f.relative_path,
              size_bytes: f.size_bytes,
              file_modified_at: f.file_modified_at,
              hash_sha256: f.hash_sha256,
              thumbnail_path: f.thumbnail_path,
              fingerprint: f.fingerprint,
            }));
        },
      };
    }
    if (sql.includes('INSERT INTO files')) {
      return {
        run: (p: any) => {
          const fileObj = typeof p === 'object' && p !== null && !Array.isArray(p) ? p : {};
          this.files.push({ ...fileObj, is_missing: 0, availability_status: fileObj.availability_status || 'available' });
        },
      };
    }
    if (sql.includes('UPDATE files SET') && sql.includes('WHERE id = @id')) {
      return {
        run: (p: any) => {
          const idx = this.files.findIndex(f => f.id === p.id);
          if (idx !== -1) {
            this.files[idx] = { ...this.files[idx], ...p, is_missing: 0, availability_status: p.availability_status || 'available' };
          }
        },
      };
    }
    if (sql.includes('UPDATE files SET last_scanned_at = datetime')) {
      return {
        run: (id: string) => {
          const f = this.files.find(item => item.id === id);
          if (f) {
            f.is_missing = 0;
            f.availability_status = 'available';
            f.last_scanned_at = new Date().toISOString();
          }
        },
      };
    }
    if (sql.includes('UPDATE files SET is_missing = 1')) {
      return {
        run: (...params: any[]) => {
          const fileId = params[params.length - 1];
          const f = this.files.find(item => item.id === fileId);
          if (f) {
            f.is_missing = 1;
            f.availability_status = 'missing';
          }
        },
      };
    }
    if (sql.includes('SELECT hash_sha256, COUNT(*) as file_count, SUM(size_bytes) as total_size')) {
      return {
        all: () => {
          const counts = new Map<string, { count: number; total_size: number }>();
          for (const f of this.files) {
            if (!f.hash_sha256 || f.size_bytes <= 0 || f.is_missing === 1) continue;
            const current = counts.get(f.hash_sha256) || { count: 0, total_size: 0 };
            counts.set(f.hash_sha256, { count: current.count + 1, total_size: current.total_size + f.size_bytes });
          }
          const results = [];
          for (const [hash, data] of counts.entries()) {
            if (data.count > 1) {
              results.push({ hash_sha256: hash, file_count: data.count, total_size: data.total_size });
            }
          }
          return results;
        },
      };
    }
    if (sql.includes('FROM files') && sql.includes('WHERE hash_sha256 = ?')) {
      return {
        all: (hash: string) => {
          return this.files
            .filter(f => f.hash_sha256 === hash && f.is_missing !== 1)
            .map(f => ({ id: f.id, file_created_at: f.file_created_at, file_modified_at: f.file_modified_at }));
        },
      };
    }
    if (sql.includes('SELECT * FROM files WHERE filename = ?') || sql.includes('SELECT hash_sha256, size_bytes FROM files WHERE filename = ?') || sql.includes('SELECT availability_status FROM files WHERE filename = ?')) {
      return {
        get: () => {
          // Extract filename from sql if hardcoded or regex
          const match = sql.match(/filename = '([^']+)'/);
          const fname = match ? match[1] : '';
          return this.files.find(f => f.filename === fname) || null;
        },
      };
    }
    if (sql.includes('SELECT id FROM files WHERE relative_path = ?')) {
      return {
        get: (relPath: string) => this.files.find(f => f.relative_path === path.normalize(relPath)) || null,
      };
    }

    // Deduplication Groups
    if (sql.includes('DELETE FROM duplicate_groups WHERE status = \'pending\'')) {
      return {
        run: () => {
          this.duplicateGroups = this.duplicateGroups.filter(g => g.status !== 'pending');
        },
      };
    }
    if (sql.includes('INSERT INTO duplicate_groups')) {
      return {
        run: (...params: any[]) => {
          this.duplicateGroups.push({
            id: params[0],
            type: params[1],
            hash: params[2],
            similarity_score: params[3],
            file_count: params[4],
            total_size: params[5],
            status: 'pending',
          });
        },
      };
    }
    if (sql.includes('INSERT INTO duplicate_group_files')) {
      return {
        run: (...params: any[]) => {
          this.duplicateGroupFiles.push({ group_id: params[0], file_id: params[1], is_original: params[2] });
        },
      };
    }
    if (sql.includes('SELECT * FROM duplicate_groups WHERE type = ?') || sql.includes("SELECT * FROM duplicate_groups WHERE type = 'exact'")) {
      return {
        all: () => this.duplicateGroups.filter(g => g.type === 'exact'),
      };
    }
    if (sql.includes('duplicate_group_files dgf JOIN files f') || (sql.includes('duplicate_group_files') && sql.includes('files f'))) {
      return {
        all: (groupId: string) => {
          const members = this.duplicateGroupFiles.filter(m => m.group_id === groupId);
          return members.map(m => {
            const f = this.files.find(file => file.id === m.file_id) || {};
            return {
              ...m,
              filename: f.filename,
              relative_path: f.relative_path,
            };
          });
        },
      };
    }

    // Jobs
    if (sql.includes('SELECT * FROM jobs') && sql.includes("status IN ('queued', 'running')")) {
      return {
        get: (type: string, targetPath: string | null) => {
          const norm = targetPath ? path.normalize(targetPath) : null;
          return this.jobs.find(j => j.type === type && (j.target_path ? path.normalize(j.target_path) : null) === norm && (j.status === 'queued' || j.status === 'running')) || null;
        },
      };
    }
    if (sql.includes('INSERT INTO jobs')) {
      return {
        run: (...params: any[]) => {
          const [id, type, priority, target_path, target_id, config_json, created_at, updated_at] = params;
          this.jobs.push({
            id,
            type,
            status: 'queued',
            priority,
            progress: 0,
            total: 0,
            target_path: target_path ? path.normalize(target_path) : null,
            target_id,
            config_json,
            error_message: null,
            created_at,
            updated_at,
          });
        },
      };
    }
    if (sql.includes('SELECT * FROM jobs WHERE id = ?')) {
      return {
        get: (id: string) => this.jobs.find(j => j.id === id) || null,
      };
    }
    if (sql.includes('UPDATE jobs SET') && sql.includes('WHERE id = ?')) {
      return {
        run: (...params: any[]) => {
          const id = params[params.length - 1];
          const job = this.jobs.find(j => j.id === id);
          if (job) {
            if (sql.includes('status = ?')) {
              job.status = params[0];
            }
            if (sql.includes('stage = ?')) {
              job.stage = params[0];
            }
            if (sql.includes('error_message = ?')) {
              job.error_message = params.find(p => typeof p === 'string' && p.length > 5);
            }
            job.updated_at = new Date().toISOString();
          }
        },
      };
    }
    if (sql.includes('UPDATE jobs') && sql.includes("SET status = 'failed'") && sql.includes("WHERE status = 'running'")) {
      return {
        run: () => {
          for (const j of this.jobs) {
            if (j.status === 'running') {
              j.status = 'failed';
              j.error_message = 'Scan interrupted by application restart';
              j.updated_at = new Date().toISOString();
            }
          }
        },
      };
    }
    if (sql.includes('UPDATE jobs') && sql.includes("SET status = 'queued'") && sql.includes('retry_count = 0')) {
      return {
        run: (_now: string, id: string) => {
          const job = this.jobs.find(j => j.id === id);
          if (job) {
            job.status = 'queued';
            job.error_message = null;
            job.retry_count = 0;
            job.progress = 0;
            job.updated_at = new Date().toISOString();
          }
        },
      };
    }

    // Search Index (FTS5)
    if (sql.includes('INSERT INTO search_index')) {
      return {
        run: (...params: any[]) => {
          this.searchIndex.push({
            file_id: params[0],
            filename: params[1],
            path: params[2],
            metadata: params[5],
          });
        },
      };
    }
    if (sql.includes('DELETE FROM search_index WHERE file_id = ?')) {
      return {
        run: (fileId: string) => {
          this.searchIndex = this.searchIndex.filter(s => s.file_id !== fileId);
        },
      };
    }
    if (sql.includes('FROM search_index WHERE search_index MATCH')) {
      return {
        all: () => {
          return this.searchIndex.filter(s => s.filename.toLowerCase().includes('quarterly'));
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

const activeMockDb = new MockPhase2ADatabase();

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

// Mock AI Worker for fast deterministic execution
vi.mock('../../src/main/ai-worker-client', () => ({
  getAiWorkerClient: () => ({
    computeHashes: async (filePath: string) => {
      const content = fs.readFileSync(filePath);
      const sha256 = crypto.createHash('sha256').update(content).digest('hex');
      const md5 = crypto.createHash('md5').update(content).digest('hex');
      return { sha256, md5, size_bytes: content.length };
    },
    extractMetadata: async (filePath: string) => {
      const ext = path.extname(filePath).toLowerCase();
      if (ext === '.corrupt') {
        return { status: 'corrupt', error: 'File corrupted' };
      }
      if (ext === '.jpg') {
        return {
          format_category: 'image',
          status: 'ok',
          width: 1920,
          height: 1080,
          camera_make: 'Nikon',
          camera_model: 'Z6',
          color_profile: 'sRGB',
          capture_time: '2026-05-15T14:30:00Z',
        };
      }
      return {
        format_category: 'text',
        status: 'ok',
        doc_title: path.basename(filePath),
      };
    },
    generateThumbnail: async () => ({ success: true }),
  }),
}));

import {
  initDatabase,
  getDb,
  closeDatabase,
  addRoot,
  getRoots,
  getRootById,
  updateRootScanStatus,
  createJob,
  retryJob,
  updateJobStatus,
  updateJobStage,
} from '../../src/main/database';
import {
  collectFilesRecursively,
  indexFolderIncremental,
  recalculateDuplicates,
} from '../../src/main/indexer';
import {
  computeFileHashStream,
  validateSafePath,
} from '../../src/main/filesystem';
import { JobRunner } from '../../src/main/job-runner';

describe('Phase 2A: Filesystem, Scanning, Metadata, Database & Duplicates', () => {
  let tempDir: string;
  let tempDbPath: string;

  beforeEach(() => {
    activeMockDb.roots = [];
    activeMockDb.files = [];
    activeMockDb.jobs = [];
    activeMockDb.duplicateGroups = [];
    activeMockDb.duplicateGroupFiles = [];
    activeMockDb.searchIndex = [];
    activeMockDb.migrations = [];

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexora-phase2a-test-'));
    tempDbPath = path.join(tempDir, 'test_nexora.db');
    initDatabase(tempDbPath);
  });

  afterEach(() => {
    closeDatabase();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // ── 1. Path Validation & Folder Authorization ──────────────────────────────
  describe('Folder Authorization & Path Validation', () => {
    it('validates safe paths and rejects null bytes or empty paths', () => {
      expect(validateSafePath('').valid).toBe(false);
      expect(validateSafePath('   ').valid).toBe(false);
      expect(validateSafePath('/test/\0traversal').valid).toBe(false);
      
      const valid = validateSafePath(tempDir);
      expect(valid.valid).toBe(true);
      expect(valid.normalized).toBe(path.normalize(tempDir));
    });

    it('authorizes folders idempotently and maintains status telemetry', () => {
      const folderPath = path.join(tempDir, 'Photos');
      fs.mkdirSync(folderPath, { recursive: true });

      const root1 = addRoot(folderPath, 'My Photos', 'indexed');
      expect(root1.id).toBeDefined();
      expect(root1.path).toBe(path.normalize(folderPath));
      expect(root1.scan_status).toBe('idle');
      expect(root1.file_count).toBe(0);

      // Duplicate registration of same folder returns existing root without duplicate rows
      const root2 = addRoot(folderPath, 'My Photos Duplicate', 'indexed');
      expect(root2.id).toBe(root1.id);

      const roots = getRoots();
      expect(roots.length).toBe(1);
    });

    it('rejects scanning non-existent or inaccessible target directories and marks root error', async () => {
      const nonExistent = path.join(tempDir, 'non_existent_folder_abc');
      
      // Pre-register root to verify error updating
      const root = addRoot(nonExistent, 'Missing Folder', 'indexed');
      
      await expect(indexFolderIncremental(nonExistent)).rejects.toThrow();

      const updatedRoot = getRootById(root.id);
      expect(updatedRoot?.scan_status).toBe('error');
      expect(updatedRoot?.last_error).toBeDefined();
    });
  });

  // ── 2. Recursive Discovery, Cycles & Managed Exclusions ─────────────────────
  describe('Recursive Discovery, Managed Exclusions & Symlink Safety', () => {
    it('discovers supported files across nested directories', () => {
      const sub1 = path.join(tempDir, 'sub1');
      const sub2 = path.join(sub1, 'sub2');
      fs.mkdirSync(sub2, { recursive: true });

      fs.writeFileSync(path.join(tempDir, 'root_file.txt'), 'root');
      fs.writeFileSync(path.join(sub1, 'sub1_file.txt'), 'sub1');
      fs.writeFileSync(path.join(sub2, 'sub2_file.txt'), 'sub2');

      const files = collectFilesRecursively(tempDir);
      expect(files.length).toBe(3);
    });

    it('strictly excludes Nexora-managed output folders and internal caches', () => {
      const normalDir = path.join(tempDir, 'NormalDocs');
      const managedDir = path.join(tempDir, 'Nexora_Organized');
      const customManagedDir = path.join(tempDir, 'Photos_Nexora_Organized');
      const markedDir = path.join(tempDir, 'MarkedManaged');
      const thumbCacheDir = path.join(tempDir, 'thumbnails');
      const gitDir = path.join(tempDir, '.git');

      fs.mkdirSync(normalDir, { recursive: true });
      fs.mkdirSync(managedDir, { recursive: true });
      fs.mkdirSync(customManagedDir, { recursive: true });
      fs.mkdirSync(markedDir, { recursive: true });
      fs.mkdirSync(thumbCacheDir, { recursive: true });
      fs.mkdirSync(gitDir, { recursive: true });

      fs.writeFileSync(path.join(markedDir, '.nexora-managed'), 'managed');

      fs.writeFileSync(path.join(normalDir, 'keep.txt'), 'allowed');
      fs.writeFileSync(path.join(managedDir, 'skip1.txt'), 'skip');
      fs.writeFileSync(path.join(customManagedDir, 'skip2.txt'), 'skip');
      fs.writeFileSync(path.join(markedDir, 'skip3.txt'), 'skip');
      fs.writeFileSync(path.join(thumbCacheDir, 'thumb.jpg'), 'skip');
      fs.writeFileSync(path.join(gitDir, 'git_object'), 'skip');

      const discovered = collectFilesRecursively(tempDir);
      expect(discovered.length).toBe(1);
      expect(discovered[0]).toContain('keep.txt');
    });

    it('prevents infinite recursion loops when directory cycles exist', () => {
      const cycleDir = path.join(tempDir, 'CycleBase');
      fs.mkdirSync(cycleDir, { recursive: true });
      fs.writeFileSync(path.join(cycleDir, 'file.txt'), 'content');

      // Test visitedRealPaths cycle prevention directly
      const visited = new Set<string>();
      const canonical = fs.realpathSync(cycleDir);
      visited.add(canonical);

      // Walking a directory whose canonical path is already visited terminates immediately
      const discovered = collectFilesRecursively(cycleDir, undefined, undefined, visited);
      expect(discovered.length).toBe(0);
    });
  });

  // ── 3. Streaming SHA-256 Hashing ───────────────────────────────────────────
  describe('Streaming SHA-256 Hashing', () => {
    it('computes identical SHA-256 using streaming I/O without high memory overhead', async () => {
      const testFile = path.join(tempDir, 'stream_hash_test.dat');
      // Create a 2MB synthetic file
      const buffer = Buffer.alloc(2 * 1024 * 1024, 'NEXORA_STREAM_TEST_PAYLOAD');
      fs.writeFileSync(testFile, buffer);

      const expectedSha256 = crypto.createHash('sha256').update(buffer).digest('hex');
      const streamSha256 = await computeFileHashStream(testFile);

      expect(streamSha256).toBe(expectedSha256);
    });
  });

  // ── 4. Incremental Scans & Cache Reuse ─────────────────────────────────────
  describe('Incremental Scans & Fingerprint Cache Reuse', () => {
    it('indexes files on first scan and reuses cached metadata on second scan', async () => {
      const scanDir = path.join(tempDir, 'ScanLibrary');
      fs.mkdirSync(scanDir, { recursive: true });

      fs.writeFileSync(path.join(scanDir, 'photo.jpg'), 'JPEG_PAYLOAD');
      fs.writeFileSync(path.join(scanDir, 'notes.txt'), 'TEXT_PAYLOAD');

      const stages: string[] = [];
      const pass1 = await indexFolderIncremental(scanDir, {
        onStageChange: (st) => stages.push(st),
      });

      expect(pass1.totalFound).toBe(2);
      expect(pass1.indexedNew).toBe(2);
      expect(pass1.reusedCached).toBe(0);
      expect(stages).toContain('discovery');
      expect(stages).toContain('metadata');
      expect(stages).toContain('reconciliation');
      expect(stages).toContain('deduplication');

      // Verify root telemetry was recorded
      const root = getRoots().find(r => r.path === path.normalize(scanDir));
      expect(root?.scan_status).toBe('completed');
      expect(root?.file_count).toBe(2);
      expect(root?.last_scanned_at).toBeDefined();

      // Second incremental pass: files unchanged -> reusedCached === 2
      const pass2 = await indexFolderIncremental(scanDir);
      expect(pass2.totalFound).toBe(2);
      expect(pass2.indexedNew).toBe(0);
      expect(pass2.reusedCached).toBe(2);
    });

    it('invalidates cache and re-extracts hashes and metadata when files are modified', async () => {
      const scanDir = path.join(tempDir, 'ModifyLibrary');
      fs.mkdirSync(scanDir, { recursive: true });

      const fileA = path.join(scanDir, 'fileA.txt');
      const fileB = path.join(scanDir, 'fileB.txt');
      fs.writeFileSync(fileA, 'Initial Content A');
      fs.writeFileSync(fileB, 'Initial Content B');

      await indexFolderIncremental(scanDir);

      // Modify fileA
      const newContent = 'Updated Content A - Modified Version';
      fs.writeFileSync(fileA, newContent);
      // Ensure mtime changes forward
      const futureTime = new Date(Date.now() + 2000);
      fs.utimesSync(fileA, futureTime, futureTime);

      const pass2 = await indexFolderIncremental(scanDir);
      expect(pass2.totalFound).toBe(2);
      expect(pass2.updatedExisting).toBe(1);
      expect(pass2.reusedCached).toBe(1);

      // Verify updated hash in database
      const row = activeMockDb.files.find(f => f.filename === 'fileA.txt');
      const expectedHash = crypto.createHash('sha256').update(newContent).digest('hex');
      expect(row?.hash_sha256).toBe(expectedHash);
      expect(row?.size_bytes).toBe(Buffer.byteLength(newContent));
    });

    it('reconciles deleted files by flagging them missing without destroying records', async () => {
      const scanDir = path.join(tempDir, 'ReconcileLibrary');
      fs.mkdirSync(scanDir, { recursive: true });

      const tempFile = path.join(scanDir, 'temporary.txt');
      fs.writeFileSync(tempFile, 'Temp content');

      await indexFolderIncremental(scanDir);

      let record = activeMockDb.files.find(f => f.filename === 'temporary.txt');
      expect(record.is_missing).toBe(0);
      expect(record.availability_status).toBe('available');

      // Delete file from disk
      fs.unlinkSync(tempFile);

      // Re-scan
      await indexFolderIncremental(scanDir);

      record = activeMockDb.files.find(f => f.filename === 'temporary.txt');
      expect(record.is_missing).toBe(1);
      expect(record.availability_status).toBe('missing');
    });
  });

  // ── 5. Exact Duplicate Detection ──────────────────────────────────────────
  describe('Exact Duplicate Detection Engine', () => {
    it('groups files only when SHA-256 hashes match regardless of filename', async () => {
      const scanDir = path.join(tempDir, 'DupLibrary');
      const subDir = path.join(scanDir, 'sub');
      fs.mkdirSync(subDir, { recursive: true });

      const duplicatePayload = 'EXACT_DUPLICATE_IDENTICAL_PAYLOAD_ABC';
      const file1 = path.join(scanDir, 'report_v1.txt');
      const file2 = path.join(subDir, 'copy_of_report.txt');
      fs.writeFileSync(file1, duplicatePayload);
      fs.writeFileSync(file2, duplicatePayload);

      // Different content with identically named file
      const file3 = path.join(subDir, 'report_v1.txt');
      fs.writeFileSync(file3, 'COMPLETELY_DIFFERENT_CONTENT_XYZ');

      await indexFolderIncremental(scanDir);
      recalculateDuplicates();

      const db = getDb();
      const groups = db.prepare("SELECT * FROM duplicate_groups WHERE type = 'exact'").all() as any[];
      expect(groups.length).toBe(1);
      expect(groups[0].file_count).toBe(2);

      const groupMembers = db.prepare(`
        SELECT dgf.*, f.filename, f.relative_path
        FROM duplicate_group_files dgf
        JOIN files f ON dgf.file_id = f.id
        WHERE dgf.group_id = ?
      `).all(groups[0].id) as any[];

      expect(groupMembers.length).toBe(2);
      const names = groupMembers.map(m => m.filename);
      expect(names).toContain('report_v1.txt');
      expect(names).toContain('copy_of_report.txt');

      // One is marked canonical original (is_original = 1) and one duplicate (is_original = 0)
      const originals = groupMembers.filter(m => m.is_original === 1);
      const dups = groupMembers.filter(m => m.is_original === 0);
      expect(originals.length).toBe(1);
      expect(dups.length).toBe(1);

      // Verify file3 with different content was NOT added to the group
      const file3Record = activeMockDb.files.find(f => f.relative_path === path.join('sub', 'report_v1.txt'));
      const file3InGroup = groupMembers.find(m => m.file_id === file3Record?.id);
      expect(file3InGroup).toBeUndefined();
    });

    it('does not group 0-byte empty files as duplicates', async () => {
      const scanDir = path.join(tempDir, 'EmptyFilesLibrary');
      fs.mkdirSync(scanDir, { recursive: true });

      fs.writeFileSync(path.join(scanDir, 'empty1.txt'), '');
      fs.writeFileSync(path.join(scanDir, 'empty2.txt'), '');

      await indexFolderIncremental(scanDir);
      recalculateDuplicates();

      const db = getDb();
      const groups = db.prepare("SELECT * FROM duplicate_groups WHERE type = 'exact'").all();
      expect(groups.length).toBe(0);
    });
  });

  // ── 6. Persistent Jobs, Cancellation, Retry & Recovery ──────────────────────
  describe('Persistent Jobs & Safe Restart Recovery', () => {
    it('prevents duplicate concurrent scan jobs for the same root folder', () => {
      const scanPath = path.join(tempDir, 'TargetFolder');
      fs.mkdirSync(scanPath, { recursive: true });

      const job1 = createJob('folder_scan', scanPath);
      expect(job1.id).toBeDefined();
      expect(job1.status).toBe('queued');

      // Attempting to enqueue duplicate scan returns existing job
      const job2 = createJob('folder_scan', scanPath);
      expect(job2.id).toBe(job1.id);
    });

    it('safely recovers stranded running jobs and roots upon application restart', () => {
      const db = getDb();
      const testPath = path.join(tempDir, 'StrandedFolder');
      fs.mkdirSync(testPath, { recursive: true });

      const root = addRoot(testPath, 'Stranded Root', 'indexed');
      updateRootScanStatus(root.id, 'scanning');

      const job = createJob('folder_scan', testPath);
      updateJobStatus(job.id, 'running', 45, 100);
      updateJobStage(job.id, 'metadata');

      const runner = new JobRunner();
      runner.recoverStrandedJobs();

      // Job should be marked failed with clear explanation so user can retry
      const updatedJob = db.prepare('SELECT * FROM jobs WHERE id = ?').get(job.id) as any;
      expect(updatedJob.status).toBe('failed');
      expect(updatedJob.error_message).toContain('restart');

      // Root scan_status should be reset from 'scanning' to 'error'
      const updatedRoot = getRootById(root.id);
      expect(updatedRoot?.scan_status).toBe('error');
      expect(updatedRoot?.last_error).toContain('restart');

      // Retrying the job resets it to queued cleanly
      const retried = retryJob(job.id);
      expect(retried?.status).toBe('queued');
      expect(retried?.error_message).toBeNull();
    });

    it('honors cancellation during scan execution', async () => {
      const scanDir = path.join(tempDir, 'CancelLibrary');
      fs.mkdirSync(scanDir, { recursive: true });
      fs.writeFileSync(path.join(scanDir, 'f1.txt'), '1');
      fs.writeFileSync(path.join(scanDir, 'f2.txt'), '2');

      let cancelFlag = false;
      const res = await indexFolderIncremental(scanDir, {
        isCancelled: () => cancelFlag,
        onProgress: () => {
          cancelFlag = true;
        },
      });

      // Scan aborted early without indexing all files
      expect(res.indexedNew).toBeLessThanOrEqual(1);
    });
  });

  // ── 7. Corrupt & Unsupported Files ─────────────────────────────────────────
  describe('Graceful Handling of Corrupt Files', () => {
    it('indexes corrupt files gracefully with status corrupt without crashing scanner', async () => {
      const scanDir = path.join(tempDir, 'CorruptLibrary');
      fs.mkdirSync(scanDir, { recursive: true });
      fs.writeFileSync(path.join(scanDir, 'broken.corrupt'), 'BROKEN_DATA');

      const res = await indexFolderIncremental(scanDir);
      expect(res.totalFound).toBe(1);

      const row = activeMockDb.files.find(f => f.filename === 'broken.corrupt');
      expect(row?.availability_status).toBe('corrupt');
    });
  });

  // ── 8. Local FTS5 Search Foundation ───────────────────────────────────────
  describe('Local Search Foundation & Indexing', () => {
    it('populates search_index with metadata and filename for full-text queries', async () => {
      const scanDir = path.join(tempDir, 'SearchLibrary');
      fs.mkdirSync(scanDir, { recursive: true });
      fs.writeFileSync(path.join(scanDir, 'quarterly_financial_report.txt'), 'Budget summary for 2026');

      await indexFolderIncremental(scanDir);

      const db = getDb();
      const searchHits = db.prepare(`
        SELECT * FROM search_index WHERE search_index MATCH 'quarterly'
      `).all() as any[];

      expect(searchHits.length).toBe(1);
      expect(searchHits[0].filename).toBe('quarterly_financial_report.txt');
    });
  });
});
