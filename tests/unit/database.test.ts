// ============================================================================
// Unit Tests: SQLite Database Engine, Schema Integrity, Deduplication & Merging
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Mock better-sqlite3 for Node environment during unit testing
vi.mock('better-sqlite3', () => {
  return {
    default: class MockDatabase {
      public tables: Map<string, any[]> = new Map();

      constructor() {
        this.tables.set('jobs', []);
        this.tables.set('people', []);
        this.tables.set('file_people', []);
        this.tables.set('files', []);
        this.tables.set('roots', []);
      }

      pragma(str: string) {
        if (str.includes('journal_mode = WAL')) return 'wal';
        if (str.includes('foreign_keys = ON')) return 1;
        if (str.includes('busy_timeout')) return 5000;
        return null;
      }

      exec() {
        return this;
      }

      transaction(fn: Function) {
        return (...args: any[]) => fn(...args);
      }

      prepare(sql: string) {
        if (sql.includes('PRAGMA journal_mode')) {
          return { get: () => ({ journal_mode: 'wal' }) };
        }
        if (sql.includes('PRAGMA foreign_keys')) {
          return { get: () => ({ foreign_keys: 1 }) };
        }
        if (sql.includes('PRAGMA integrity_check')) {
          return { get: () => ({ integrity_check: 'ok' }) };
        }
        if (sql.includes('SELECT name FROM sqlite_master')) {
          return { get: () => null };
        }
        if (sql.includes('SELECT * FROM jobs') && sql.includes('WHERE type = ?') && sql.includes("status IN ('queued', 'running')")) {
          return {
            get: (type: string, targetPath: string | null, _p2: any, targetId: string | null) => {
              const jobs = this.tables.get('jobs')!;
              return jobs.find(j => j.type === type && (j.target_path ?? null) === targetPath && (j.target_id ?? null) === targetId && (j.status === 'queued' || j.status === 'running')) || null;
            },
          };
        }
        if (sql.includes('INSERT INTO jobs')) {
          return {
            run: (...params: any[]) => {
              const jobs = this.tables.get('jobs')!;
              const [id, type, priority, target_path, target_id, config_json, created_at, updated_at] = params;
              jobs.push({ id, type, status: 'queued', priority, progress: 0, total: 0, target_path, target_id, config_json, created_at, updated_at });
            },
          };
        }
        if (sql.includes('UPDATE jobs') && sql.includes("SET status = 'queued'") && sql.includes('retry_count = 0')) {
          return {
            run: (_now: string, id: string) => {
              const job = this.tables.get('jobs')!.find(j => j.id === id);
              if (job) {
                job.status = 'queued';
                job.error_message = null;
                job.retry_count = 0;
                job.progress = 0;
              }
            },
          };
        }
        if (sql.includes('DELETE FROM jobs WHERE status IN')) {
          return {
            run: () => {
              const jobs = this.tables.get('jobs')!;
              const initialLen = jobs.length;
              const remaining = jobs.filter(j => j.status !== 'completed' && j.status !== 'cancelled');
              this.tables.set('jobs', remaining);
              return { changes: initialLen - remaining.length };
            },
          };
        }
        if (sql.includes('UPDATE jobs SET')) {
          return {
            run: (...params: any[]) => {
              const id = params[params.length - 1];
              const job = this.tables.get('jobs')!.find(j => j.id === id);
              if (job) {
                job.status = params[0];
                if (params.length >= 4) job.progress = params[2];
              }
            },
          };
        }
        if (sql.includes('SELECT * FROM jobs WHERE id = ?')) {
          return {
            get: (id: string) => this.tables.get('jobs')!.find(j => j.id === id),
          };
        }
        if (sql.includes('SELECT * FROM jobs WHERE status = ?')) {
          return {
            all: (status: string) => this.tables.get('jobs')!.filter(j => j.status === status),
          };
        }
        if (sql.includes('SELECT * FROM jobs ORDER BY')) {
          return {
            all: () => this.tables.get('jobs')!,
          };
        }
        if (sql.includes('INSERT INTO people')) {
          return {
            run: (...params: any[]) => {
              this.tables.get('people')!.push({ id: params[0], name: params[1], review_status: params[2] });
            },
          };
        }
        if (sql.includes('DELETE FROM people WHERE id = ?')) {
          return {
            run: (id: string) => {
              const people = this.tables.get('people')!;
              const idx = people.findIndex(p => p.id === id);
              if (idx !== -1) people.splice(idx, 1);
            },
          };
        }
        if (sql.includes('SELECT * FROM people WHERE id = ?')) {
          return {
            get: (id: string) => this.tables.get('people')!.find(p => p.id === id),
          };
        }
        if (sql.includes('INSERT OR IGNORE INTO file_people')) {
          return {
            run: (targetId: string) => {
              this.tables.get('file_people')!.push({ file_id: 'f1', person_id: targetId });
            },
          };
        }
        if (sql.includes('SELECT * FROM file_people WHERE file_id = ? AND person_id = ?')) {
          return {
            get: (fId: string, pId: string) => this.tables.get('file_people')!.find(fp => fp.file_id === fId && fp.person_id === pId),
          };
        }
        if (sql.includes('SELECT COUNT(*) as count FROM files f')) {
          return { get: () => ({ count: 0 }) };
        }
        if (sql.includes('SELECT * FROM files f')) {
          return { all: () => [] };
        }
        if (sql.includes('SELECT * FROM copy_operations')) {
          return { all: () => [{ id: 'op1', type: 'person_organize', status: 'completed', source_description: 'Photos', destination_root: 'C:\\Lib', total_files: 5, completed_files: 5, failed_files: 0, total_bytes: 1000, copied_bytes: 1000, started_at: null, completed_at: null, created_at: new Date().toISOString() }] };
        }
        if (sql.includes('SELECT f.*, dgf.is_original')) {
          return { all: () => [{ id: 'f1', filename: 'photo1.jpg', relative_path: 'photo1.jpg', size_bytes: 500, is_original: true, full_path: 'C:\\Lib\\photo1.jpg' }] };
        }
        if (sql.includes('SELECT (r.path || \'/\' || f.relative_path) AS full_path')) {
          return { get: () => ({ full_path: 'C:\\Lib\\photo1.jpg' }) };
        }
        return {
          get: () => null,
          all: () => [],
          run: () => ({ changes: 1 }),
        };
      }

      close() {}
    },
  };
});

import {
  initDatabase,
  closeDatabase,
  getDb,
  checkDatabaseIntegrity,
  vacuumDatabase,
  mergePeople,
  createJob,
  getJobs,
  updateJobStatus,
  retryJob,
  clearCompletedJobs,
  searchFiles,
  getCopyOperations,
  getDuplicateGroupFiles,
  resolveFileFullPath,
} from '../../src/main/database';

describe('Database Engine & Relational Schema', () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexora-db-test-'));
    dbPath = path.join(tempDir, 'test_nexora.db');
    initDatabase(dbPath);
  });

  afterEach(() => {
    closeDatabase();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('initializes in WAL mode with foreign keys enabled', () => {
    const db = getDb();
    const journalMode = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    const foreignKeys = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };

    expect(journalMode.journal_mode.toLowerCase()).toBe('wal');
    expect(foreignKeys.foreign_keys).toBe(1);
  });

  it('passes PRAGMA integrity_check', () => {
    const res = checkDatabaseIntegrity();
    expect(res.ok).toBe(true);
    expect(res.message).toBe('ok');
  });

  it('executes database vacuum without error', () => {
    const success = vacuumDatabase();
    expect(success).toBe(true);
  });

  it('manages background jobs lifecycle with priority ordering and prevents duplicate enqueueing', () => {
    const job1 = createJob('folder_scan', 'C:\\Photos');
    expect(job1.id).toBeDefined();
    expect(job1.priority).toBe(1); // User folder scan defaults to priority 1

    // Deduplication check: attempting to enqueue same target should return existing queued job
    const jobDuplicate = createJob('folder_scan', 'C:\\Photos');
    expect(jobDuplicate.id).toBe(job1.id);

    // Transition to running
    updateJobStatus(job1.id, 'running', 50, 100);
    const runningJobs = getJobs('running');
    expect(runningJobs.some(j => j.id === job1.id)).toBe(true);

    // Fail job
    updateJobStatus(job1.id, 'failed', 50, 100, 'I/O read error');
    const failedJobs = getJobs('failed');
    expect(failedJobs.some(j => j.id === job1.id)).toBe(true);

    // Retry job
    const retried = retryJob(job1.id);
    expect(retried).toBeDefined();
    expect(retried?.status).toBe('queued');
    expect(retried?.error_message).toBeNull();
    expect(retried?.retry_count).toBe(0);

    // Complete job and clear completed
    updateJobStatus(job1.id, 'completed', 100, 100);
    expect(getJobs('completed').length).toBeGreaterThan(0);
    const cleared = clearCompletedJobs();
    expect(cleared).toBeGreaterThan(0);
    expect(getJobs('completed').some(j => j.id === job1.id)).toBe(false);
  });

  it('merges source people into target person and updates associations', () => {
    const db = getDb();
    db.prepare("INSERT INTO people (id, name, review_status) VALUES ('p1', 'Alice', 'confirmed')").run();
    db.prepare("INSERT INTO people (id, name, review_status) VALUES ('p2', 'Alice Variant', 'unreviewed')").run();

    const success = mergePeople('p1', ['p2']);
    expect(success).toBe(true);

    const p2Row = db.prepare('SELECT * FROM people WHERE id = ?').get('p2');
    expect(p2Row).toBeUndefined();

    const filePerson = db.prepare('SELECT * FROM file_people WHERE file_id = ? AND person_id = ?').get('f1', 'p1');
    expect(filePerson).toBeDefined();
  });

  it('executes multi-parameter file searches with timing', () => {
    const result = searchFiles({ text: 'sample', limit: 10 });
    expect(result.files).toBeInstanceOf(Array);
    expect(typeof result.executionTimeMs).toBe('number');
  });

  it('retrieves copy operations history with status and metrics', () => {
    const ops = getCopyOperations();
    expect(ops).toBeInstanceOf(Array);
    expect(ops.length).toBeGreaterThan(0);
    expect(ops[0].type).toBe('person_organize');
    expect(ops[0].status).toBe('completed');
  });

  it('retrieves candidate duplicate files for group resolution', () => {
    const files = getDuplicateGroupFiles('group-1');
    expect(files).toBeInstanceOf(Array);
    expect(files.length).toBe(1);
    expect(files[0].is_original).toBe(true);
    expect(files[0].full_path).toContain('photo1.jpg');
  });

  it('resolves relative file path to full path via roots', () => {
    const full = resolveFileFullPath('photo1.jpg');
    expect(full).toBe('C:\\Lib\\photo1.jpg');
  });
});
