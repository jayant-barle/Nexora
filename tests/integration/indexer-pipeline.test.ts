// ============================================================================
// Integration Tests: Incremental Indexing, Search & Deduplication Pipeline
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';

// Mock electron app before imports
vi.mock('electron', () => ({
  app: {
    getPath: () => os.tmpdir(),
  },
}));

// Mock AI worker client for fast deterministic integration testing
vi.mock('../../src/main/ai-worker-client', () => ({
  getAiWorkerClient: () => ({
    computeHashes: async (filePath: string) => {
      const content = fs.readFileSync(filePath);
      const sha256 = crypto.createHash('sha256').update(content).digest('hex');
      const md5 = crypto.createHash('md5').update(content).digest('hex');
      return { sha256, md5, size_bytes: content.length };
    },
    extractMetadata: async () => ({}),
  }),
}));

// Simulated in-memory database mock for integration testing
class MockIntegrationDb {
  public files: any[] = [];
  public roots: any[] = [];
  public duplicateGroups: any[] = [];
  public duplicateGroupFiles: any[] = [];
  public searchIndex: any[] = [];
  public jobs: any[] = [];

  pragma() { return null; }
  exec(sql: string) {
    if (sql.includes('DELETE FROM duplicate_groups')) {
      this.duplicateGroups = this.duplicateGroups.filter(g => g.status !== 'pending');
    }
    return this;
  }
  transaction(fn: Function) {
    return (...args: any[]) => fn(...args);
  }

  prepare(sql: string) {
    if (sql.includes('FROM roots WHERE path = ?')) {
      return {
        get: (p: string) => this.roots.find(r => r.path === p),
      };
    }
    if (sql.includes('INSERT INTO roots')) {
      return {
        run: (...params: any[]) => {
          this.roots.push({ id: params[0], path: params[1], label: params[2], type: params[3] });
        },
      };
    }
    if (sql.includes('FROM files WHERE root_id = ?')) {
      return {
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
            }));
        },
      };
    }
    if (sql.includes('INSERT INTO files')) {
      return {
        run: (...params: any[]) => {
          const p = typeof params[0] === 'object' && params[0] !== null && !Array.isArray(params[0])
            ? params[0]
            : {
                id: params[0], root_id: params[1], relative_path: params[2], filename: params[3],
                extension: params[4], mime_type: params[5], size_bytes: params[6], hash_sha256: params[7],
                width: params[8], height: params[9], duration_seconds: params[10], capture_time: params[11],
                file_created_at: params[12], file_modified_at: params[13], has_gps: params[14],
                latitude: params[15], longitude: params[16], thumbnail_path: params[17],
                metadata_json: params[18], processing_status: params[19],
              };

          const existingIdx = this.files.findIndex(f => f.root_id === p.root_id && f.relative_path === p.relative_path);
          if (existingIdx !== -1) {
            this.files[existingIdx] = { ...p };
          } else {
            this.files.push({ ...p });
          }
        },
      };
    }
    if (sql.includes('INSERT OR REPLACE INTO search_index')) {
      return {
        run: (...params: any[]) => {
          this.searchIndex.push({ file_id: params[0], filename: params[1], path: params[2], metadata: params[5] });
        },
      };
    }
    if (sql.includes('UPDATE files SET last_scanned_at = datetime(\'now\') WHERE id = ?')) {
      return {
        run: (id: string) => {
          const f = this.files.find(file => file.id === id);
          if (f) f.last_scanned_at = new Date().toISOString();
        },
      };
    }
    if (sql.includes('SELECT hash_sha256, COUNT(*) as file_count, SUM(size_bytes) as total_size')) {
      return {
        all: () => {
          const counts = new Map<string, { count: number; total_size: number }>();
          for (const f of this.files) {
            if (!f.hash_sha256) continue;
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
    if (sql.includes('SELECT id, file_created_at FROM files WHERE hash_sha256 = ?')) {
      return {
        all: (hash: string) => this.files.filter(f => f.hash_sha256 === hash).map(f => ({ id: f.id, file_created_at: f.file_created_at })),
      };
    }
    if (sql.includes('SELECT id, size_bytes, file_created_at, metadata_json')) {
      return {
        all: () => this.files.map(f => ({ id: f.id, size_bytes: f.size_bytes, file_created_at: f.file_created_at, metadata_json: f.metadata_json })),
      };
    }
    if (sql.includes('DELETE FROM duplicate_groups')) {
      return {
        run: () => {
          this.duplicateGroups = this.duplicateGroups.filter(g => g.status !== 'pending');
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

const mockDbInstance = new MockIntegrationDb();

vi.mock('../../src/main/database', () => {
  return {
    getDb: () => mockDbInstance,
    initDatabase: () => {},
    closeDatabase: () => {},
    getSettings: () => ({ resourceProfile: 'balanced', enableBackgroundAi: 'true' }),
    getSetting: () => null,
    setSetting: () => {},
  };
});

import { indexFolderIncremental, collectFilesRecursively, recalculateDuplicates } from '../../src/main/indexer';

describe('Integration: Incremental Indexing & Duplicate Engine', () => {
  let tempLibrary: string;

  beforeEach(() => {
    mockDbInstance.files = [];
    mockDbInstance.roots = [];
    mockDbInstance.duplicateGroups = [];
    mockDbInstance.duplicateGroupFiles = [];
    mockDbInstance.searchIndex = [];

    tempLibrary = fs.mkdtempSync(path.join(os.tmpdir(), 'nexora-int-test-'));

    // Create synthetic library structure
    fs.mkdirSync(path.join(tempLibrary, 'Documents'), { recursive: true });
    fs.mkdirSync(path.join(tempLibrary, 'Photos'), { recursive: true });

    fs.writeFileSync(path.join(tempLibrary, 'Documents', 'doc1.txt'), 'Sample document 1 content');
    fs.writeFileSync(path.join(tempLibrary, 'Documents', 'doc2.txt'), 'Sample document 1 content'); // Exact duplicate content
    fs.writeFileSync(path.join(tempLibrary, 'Photos', 'photo_a.jpg'), 'JPEG_HEADER_SIMULATION_A');
  });

  afterEach(() => {
    try {
      fs.rmSync(tempLibrary, { recursive: true, force: true });
    } catch {}
  });

  it('scans and collects all files recursively skipping excluded system patterns', () => {
    const files = collectFilesRecursively(tempLibrary);
    expect(files.length).toBe(3);
    expect(files.some(f => f.endsWith('doc1.txt'))).toBe(true);
    expect(files.some(f => f.endsWith('photo_a.jpg'))).toBe(true);
  });

  it('performs incremental scan, indexing new files on first pass and skipping on second pass', async () => {
    // 1st pass: All 3 files are new
    const firstPass = await indexFolderIncremental(tempLibrary);
    expect(firstPass.totalFound).toBe(3);
    expect(firstPass.indexedNew).toBe(3);
    expect(firstPass.reusedCached).toBe(0);
    expect(mockDbInstance.files.length).toBe(3);

    // 2nd pass immediately after: Files unchanged -> should reuse cached metadata
    const secondPass = await indexFolderIncremental(tempLibrary);
    expect(secondPass.totalFound).toBe(3);
    expect(secondPass.indexedNew).toBe(0);
    expect(secondPass.reusedCached).toBe(3);
  });

  it('recalculates exact duplicates and separates canonical original from duplicates', async () => {
    await indexFolderIncremental(tempLibrary);
    recalculateDuplicates();

    // doc1.txt and doc2.txt have identical content and therefore identical SHA-256
    const exactGroups = mockDbInstance.duplicateGroups.filter(g => g.type === 'exact');
    expect(exactGroups.length).toBe(1);
    expect(exactGroups[0].file_count).toBe(2);

    // One must be marked canonical original (is_original = 1), and one duplicate (is_original = 0)
    const members = mockDbInstance.duplicateGroupFiles.filter(m => m.group_id === exactGroups[0].id);
    expect(members.length).toBe(2);
    const originalCount = members.filter(m => m.is_original === 1).length;
    const dupCount = members.filter(m => m.is_original === 0).length;
    expect(originalCount).toBe(1);
    expect(dupCount).toBe(1);
  });
});
