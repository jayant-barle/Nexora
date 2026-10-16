// ============================================================================
// Integration Tests: Metadata Intelligence Engine
// Tests: Incremental caching, force rescan, missing file reconciliation, rich search
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';

// In-memory Database mock for Integration testing
class MockFullMetadataDb {
  public roots: any[] = [];
  public files: any[] = [];
  public searchIndex: any[] = [];
  public duplicateGroups: any[] = [];

  pragma(str: string) {
    if (str.includes('journal_mode = WAL')) return 'wal';
    if (str.includes('foreign_keys = ON')) return 1;
    if (str.includes('busy_timeout')) return 5000;
    return null;
  }
  exec() { return this; }
  transaction(fn: Function) {
    return (...args: any[]) => fn(...args);
  }
  close() {}

  prepare(sql: string) {
    if (sql.includes('SELECT name FROM sqlite_master')) {
      return { get: () => null };
    }
    if (sql.includes('PRAGMA integrity_check')) {
      return { get: () => ({ integrity_check: 'ok' }) };
    }
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
        run: (p: any) => {
          const idx = this.files.findIndex(f => f.root_id === p.root_id && f.relative_path === p.relative_path);
          if (idx !== -1) {
            this.files[idx] = { ...this.files[idx], ...p, is_missing: 0, availability_status: 'available' };
          } else {
            this.files.push({ ...p, is_missing: 0, availability_status: 'available' });
          }
        },
      };
    }
    if (sql.includes('UPDATE files SET') && sql.includes('WHERE id = @id')) {
      return {
        run: (p: any) => {
          const idx = this.files.findIndex(f => f.id === p.id);
          if (idx !== -1) {
            this.files[idx] = { ...this.files[idx], ...p, is_missing: 0, availability_status: 'available' };
          }
        },
      };
    }
    if (sql.includes('UPDATE files SET last_scanned_at = datetime(\'now\')')) {
      return {
        run: (id: string) => {
          const f = this.files.find(item => item.id === id);
          if (f) {
            f.is_missing = 0;
            f.availability_status = 'available';
          }
        },
      };
    }
    if (sql.includes('UPDATE files SET is_missing = 1')) {
      return {
        run: (...params: any[]) => {
          const fileId = params.length === 2 ? params[1] : params[0];
          const f = this.files.find(item => item.id === fileId);
          if (f) {
            f.is_missing = 1;
            f.availability_status = 'missing';
          }
        },
      };
    }
    if (sql.includes('UPDATE files SET is_missing = 0')) {
      return {
        run: (id: string) => {
          const f = this.files.find(item => item.id === id);
          if (f) {
            f.is_missing = 0;
            f.availability_status = 'available';
          }
        },
      };
    }
    if (sql.includes('INSERT INTO search_index')) {
      return {
        run: (fileId: string, filename: string, pathStr: string, text: string) => {
          this.searchIndex.push({ fileId, filename, pathStr, text });
        },
      };
    }
    if (sql.includes('DELETE FROM search_index WHERE file_id = ?')) {
      return {
        run: (fileId: string) => {
          this.searchIndex = this.searchIndex.filter(s => s.fileId !== fileId);
        },
      };
    }
    if (sql.includes('SELECT f.id, f.relative_path, f.is_missing, r.path as root_path')) {
      return {
        all: () => {
          return this.files.map(f => {
            const root = this.roots.find(r => r.id === f.root_id);
            return {
              id: f.id,
              relative_path: f.relative_path,
              is_missing: f.is_missing || 0,
              root_path: root?.path || '',
            };
          });
        },
      };
    }
    if (sql.includes('SELECT COUNT(*) as count FROM files f')) {
      return {
        get: (params: any) => {
          let filtered = [...this.files];
          if (params?.camera) {
            const c = params.camera.replace(/%/g, '').toLowerCase();
            filtered = filtered.filter(f => (f.camera_make || '').toLowerCase().includes(c) || (f.camera_model || '').toLowerCase().includes(c));
          }
          if (params?.author) {
            const a = params.author.replace(/%/g, '').toLowerCase();
            filtered = filtered.filter(f => (f.doc_author || '').toLowerCase().includes(a));
          }
          if (params?.artist) {
            const a = params.artist.replace(/%/g, '').toLowerCase();
            filtered = filtered.filter(f => (f.audio_artist || '').toLowerCase().includes(a) || (f.audio_album || '').toLowerCase().includes(a));
          }
          if (params?.isMissing !== undefined) {
            filtered = filtered.filter(f => f.is_missing === params.isMissing);
          }
          return { count: filtered.length };
        },
      };
    }
    if (sql.includes('SELECT * FROM files f')) {
      return {
        all: (params: any) => {
          let filtered = [...this.files];
          if (params?.camera) {
            const c = params.camera.replace(/%/g, '').toLowerCase();
            filtered = filtered.filter(f => (f.camera_make || '').toLowerCase().includes(c) || (f.camera_model || '').toLowerCase().includes(c));
          }
          if (params?.author) {
            const a = params.author.replace(/%/g, '').toLowerCase();
            filtered = filtered.filter(f => (f.doc_author || '').toLowerCase().includes(a));
          }
          if (params?.artist) {
            const a = params.artist.replace(/%/g, '').toLowerCase();
            filtered = filtered.filter(f => (f.audio_artist || '').toLowerCase().includes(a) || (f.audio_album || '').toLowerCase().includes(a));
          }
          if (params?.isMissing !== undefined) {
            filtered = filtered.filter(f => f.is_missing === params.isMissing);
          }
          return filtered;
        },
      };
    }
    return {
      run: () => ({ changes: 1 }),
      get: () => null,
      all: () => [],
    };
  }
}

let activeMockDb = new MockFullMetadataDb();

vi.mock('better-sqlite3', () => {
  return {
    default: class {
      constructor() {
        return activeMockDb;
      }
    },
  };
});

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
    extractMetadata: async (filePath: string) => {
      const ext = path.extname(filePath).toLowerCase();
      if (ext === '.jpg') {
        return {
          format_category: 'image',
          status: 'ok',
          width: 3840,
          height: 2160,
          camera_make: 'Sony',
          camera_model: 'A7IV',
          lens_model: 'FE 24-70mm F2.8 GM II',
          iso: 200,
          focal_length: 50.0,
          aperture: 2.8,
          exposure_time: '1/250',
          capture_time: '2026-07-20T11:00:00Z',
          has_gps: true,
          latitude: 37.7749,
          longitude: -122.4194,
        };
      }
      if (ext === '.pdf') {
        return {
          format_category: 'document',
          status: 'ok',
          doc_title: 'Quantum Computing Overview',
          doc_author: 'Alice Martin',
          doc_subject: 'Physics',
          page_count: 42,
          word_count: 12500,
          text_preview: 'Superposition and entanglement in superconducting qubits.',
        };
      }
      if (ext === '.mp3') {
        return {
          format_category: 'audio',
          status: 'ok',
          audio_title: 'Midnight Sun',
          audio_artist: 'Starlight Orchestra',
          audio_album: 'Celestial Harmonies',
          duration_seconds: 245.5,
          bitrate: 320000,
        };
      }
      return {
        format_category: 'other',
        status: 'ok',
      };
    },
    detectFaces: async () => [],
    generateThumbnail: async () => ({ success: false }),
  }),
}));

import { initDatabase, closeDatabase, searchFiles } from '../../src/main/database';
import { indexFolderIncremental, reconcileLibrary } from '../../src/main/indexer';
import type { SearchQuery } from '../../src/shared/types';

describe('Integration: Metadata Intelligence Engine', () => {
  let tempFolder: string;

  beforeEach(() => {
    activeMockDb = new MockFullMetadataDb();
    tempFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'nexora-meta-int-'));
    initDatabase(path.join(tempFolder, 'test.db'));
  });

  afterEach(() => {
    closeDatabase();
    try {
      fs.rmSync(tempFolder, { recursive: true, force: true });
    } catch {}
  });

  it('performs incremental scan caching, touching unchanged files and re-extracting modified files', async () => {
    const file1 = path.join(tempFolder, 'photo.jpg');
    const file2 = path.join(tempFolder, 'report.pdf');
    fs.writeFileSync(file1, 'fake jpg binary');
    fs.writeFileSync(file2, 'fake pdf binary');

    // First scan: indexes both files as new
    const firstPass = await indexFolderIncremental(tempFolder);
    expect(firstPass.totalFound).toBe(2);
    expect(firstPass.indexedNew).toBe(2);
    expect(firstPass.reusedCached).toBe(0);

    // Verify rich metadata was stored in database
    const imgRecord = activeMockDb.files.find(f => f.filename === 'photo.jpg');
    expect(imgRecord.camera_make).toBe('Sony');
    expect(imgRecord.camera_model).toBe('A7IV');
    expect(imgRecord.has_gps).toBe(1);

    const pdfRecord = activeMockDb.files.find(f => f.filename === 'report.pdf');
    expect(pdfRecord.doc_author).toBe('Alice Martin');
    expect(pdfRecord.page_count).toBe(42);

    // Second scan without modification: 100% cache hit!
    const secondPass = await indexFolderIncremental(tempFolder);
    expect(secondPass.totalFound).toBe(2);
    expect(secondPass.indexedNew).toBe(0);
    expect(secondPass.reusedCached).toBe(2);

    // Modify file1: must reprocess only file1, reusing file2
    fs.appendFileSync(file1, ' appended bytes');
    const thirdPass = await indexFolderIncremental(tempFolder);
    expect(thirdPass.totalFound).toBe(2);
    expect(thirdPass.updatedExisting).toBe(1);
    expect(thirdPass.reusedCached).toBe(1);

    // Force full rescan: reprocesses everything regardless of timestamp
    const fullPass = await indexFolderIncremental(tempFolder, { forceFullRescan: true });
    expect(fullPass.reusedCached).toBe(0);
    expect(fullPass.updatedExisting).toBe(2);
  });

  it('detects missing files without deleting records or losing user history, and restores availability upon file return', async () => {
    const fileA = path.join(tempFolder, 'track.mp3');
    fs.writeFileSync(fileA, 'mp3 binary data');

    // Index file
    await indexFolderIncremental(tempFolder);
    const originalRecord = activeMockDb.files.find(f => f.filename === 'track.mp3');
    expect(originalRecord.is_missing).toBe(0);
    expect(originalRecord.audio_artist).toBe('Starlight Orchestra');

    // Simulate file being moved/missing on disk
    fs.unlinkSync(fileA);

    // Reconcile library
    const reconcileRes = reconcileLibrary();
    expect(reconcileRes.missingCount).toBe(1);

    // Record MUST STILL EXIST in database (never deleted!)
    const missingRecord = activeMockDb.files.find(f => f.filename === 'track.mp3');
    expect(missingRecord).toBeDefined();
    expect(missingRecord.is_missing).toBe(1);
    expect(missingRecord.availability_status).toBe('missing');
    expect(missingRecord.audio_artist).toBe('Starlight Orchestra');

    // Put file back and scan again
    fs.writeFileSync(fileA, 'restored mp3 binary data');
    const restoreRes = reconcileLibrary();
    expect(restoreRes.restoredCount).toBe(1);

    const restoredRecord = activeMockDb.files.find(f => f.filename === 'track.mp3');
    expect(restoredRecord.is_missing).toBe(0);
    expect(restoredRecord.availability_status).toBe('available');
  });

  it('filters indexed files by rich metadata: camera, author, artist, and missing status', () => {
    activeMockDb.files = [
      {
        id: 'f1',
        filename: 'landscape.jpg',
        relative_path: 'landscape.jpg',
        extension: '.jpg',
        mime_type: 'image/jpeg',
        camera_make: 'Sony',
        camera_model: 'A7IV',
        doc_author: null,
        audio_artist: null,
        is_missing: 0,
      },
      {
        id: 'f2',
        filename: 'thesis.pdf',
        relative_path: 'thesis.pdf',
        extension: '.pdf',
        mime_type: 'application/pdf',
        camera_make: null,
        camera_model: null,
        doc_author: 'Alice Martin',
        audio_artist: null,
        is_missing: 0,
      },
      {
        id: 'f3',
        filename: 'symphony.mp3',
        relative_path: 'symphony.mp3',
        extension: '.mp3',
        mime_type: 'audio/mpeg',
        camera_make: null,
        camera_model: null,
        doc_author: null,
        audio_artist: 'Starlight Orchestra',
        is_missing: 1,
      },
    ];

    // Filter by camera
    const cameraQuery: SearchQuery = { camera: 'Sony' };
    const cameraResults = searchFiles(cameraQuery);
    expect(cameraResults.totalCount).toBe(1);
    expect(cameraResults.files[0].filename).toBe('landscape.jpg');

    // Filter by author
    const authorQuery: SearchQuery = { author: 'Alice' };
    const authorResults = searchFiles(authorQuery);
    expect(authorResults.totalCount).toBe(1);
    expect(authorResults.files[0].filename).toBe('thesis.pdf');

    // Filter by artist
    const artistQuery: SearchQuery = { artist: 'Starlight' };
    const artistResults = searchFiles(artistQuery);
    expect(artistResults.totalCount).toBe(1);
    expect(artistResults.files[0].filename).toBe('symphony.mp3');

    // Filter by missing status
    const missingQuery: SearchQuery = { isMissing: true };
    const missingResults = searchFiles(missingQuery);
    expect(missingResults.totalCount).toBe(1);
    expect(missingResults.files[0].filename).toBe('symphony.mp3');
  });
});
