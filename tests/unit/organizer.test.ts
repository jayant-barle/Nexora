// ============================================================================
// Unit Tests: Metadata-Based Organization & Preview Engine
// Tests: Template resolution, deterministic fallbacks, collision avoidance, verified copy
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import {
  resolveOrganizationPath,
  getFileCategory,
  generateOrganizationProposals,
  executeOrganization,
  getOrganizationRules,
  saveOrganizationRule,
} from '../../src/main/organizer';
import type { FileRecord } from '../../src/shared/types';

// Mock database for isolated unit testing
class MockOrganizerDb {
  public files: any[] = [];
  public rules: any[] = [];
  public copyOperations: any[] = [];
  public operationItems: any[] = [];
  public operationHistory: any[] = [];

  constructor() {
    this.rules = [
      { id: 'rule_1', name: 'Date Hierarchy', pattern: '{category}/{YYYY}/{MM}', is_default: 1, created_at: '', updated_at: '' },
      { id: 'rule_2', name: 'Camera & Date', pattern: 'Media/{camera}/{YYYY}/{MM}', is_default: 0, created_at: '', updated_at: '' },
      { id: 'rule_3', name: 'Person & Date', pattern: 'People/{person}/{YYYY}', is_default: 0, created_at: '', updated_at: '' },
    ];
  }

  prepare(sql: string) {
    if (sql.includes('SELECT * FROM organization_rules WHERE id = ?')) {
      return {
        get: (id: string) => this.rules.find(r => r.id === id) || this.rules[this.rules.length - 1],
      };
    }
    if (sql.includes('SELECT * FROM organization_rules')) {
      return {
        all: () => [...this.rules],
      };
    }
    if (sql.includes('INSERT INTO organization_rules')) {
      return {
        run: (...params: any[]) => {
          this.rules.push({ id: params[0], name: params[1], description: params[2], pattern: params[3], is_default: params[5] });
        },
      };
    }
    if (sql.includes('UPDATE operation_items')) {
      return {
        run: (...params: any[]) => {},
      };
    }
    if (sql.includes('INSERT INTO copy_operations')) {
      return {
        run: (...params: any[]) => {
          this.copyOperations.push(params);
        },
      };
    }
    if (sql.includes('INSERT INTO operation_items')) {
      return {
        run: (...params: any[]) => {
          this.operationItems.push(params);
        },
      };
    }
    if (sql.includes('INSERT INTO operation_history')) {
      return {
        run: (...params: any[]) => {
          this.operationHistory.push(params);
        },
      };
    }
    if (sql.includes('FROM files f')) {
      return {
        all: () => [...this.files],
      };
    }
    return {
      run: () => {},
      get: () => null,
      all: () => [],
    };
  }

  transaction(fn: Function) {
    return (...args: any[]) => fn(...args);
  }
}

let mockDb = new MockOrganizerDb();
vi.mock('../../src/main/database', () => ({
  getDb: () => mockDb,
}));

describe('Metadata Organization & Preview Engine', () => {
  let tempDir: string;
  let sourceDir: string;
  let destDir: string;

  beforeEach(() => {
    mockDb = new MockOrganizerDb();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexora-org-test-'));
    sourceDir = path.join(tempDir, 'source');
    destDir = path.join(tempDir, 'destination');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.mkdirSync(destDir, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // ── Format Category Mapping ────────────────────────────────────────────────

  it('accurately resolves file formats to high-level categories', () => {
    expect(getFileCategory('.jpg')).toBe('Images');
    expect(getFileCategory('.png')).toBe('Images');
    expect(getFileCategory('.mp4')).toBe('Videos');
    expect(getFileCategory('.pdf')).toBe('Documents');
    expect(getFileCategory('.docx')).toBe('Documents');
    expect(getFileCategory('.mp3')).toBe('Audio');
    expect(getFileCategory('.zip')).toBe('Archives');
    expect(getFileCategory('.txt')).toBe('Text');
    expect(getFileCategory('.unknown')).toBe('Other');
  });

  // ── Template Token Resolution ──────────────────────────────────────────────

  it('resolves date, category, camera, person, and author tokens', () => {
    const file: Partial<FileRecord> = {
      filename: 'DSC_0042.jpg',
      extension: '.jpg',
      capture_time: '2026-08-15T14:30:00Z',
      camera_make: 'Sony',
      camera_model: 'ILCE-7M4',
      doc_author: null,
    };

    const res = resolveOrganizationPath(
      file as FileRecord,
      '{category}/{YYYY}/{MM}/{camera}/{person}',
      'Sarah Connor'
    );

    expect(res.relativeFolder).toBe(path.join('Images', '2026', '08', 'Sony ILCE-7M4', 'Sarah Connor'));
    expect(res.warnings).toHaveLength(0);
  });

  it('uses deterministic safe fallbacks when metadata is missing without inventing facts', () => {
    const file: Partial<FileRecord> = {
      filename: 'orphan_file.bin',
      extension: '.bin',
      capture_time: null,
      file_created_at: null,
      file_modified_at: null,
      camera_make: null,
      camera_model: null,
      doc_author: null,
    };

    const res = resolveOrganizationPath(
      file as FileRecord,
      '{category}/{YYYY}/{camera}/{person}/{location}/{author}'
    );

    expect(res.relativeFolder).toBe(path.join('Other', 'Unknown Date', 'Unknown Camera', 'Unassigned', 'Unknown Location', 'Unknown Author'));
    expect(res.warnings.length).toBeGreaterThan(0);
  });

  // ── Collision Avoidance & Duplicate Detection ──────────────────────────────

  it('generates proposal preview detecting duplicates and avoiding unnecessary copies', async () => {
    const sampleSrc = path.join(sourceDir, 'photo.jpg');
    const content = 'Test photo image content for hash check';
    fs.writeFileSync(sampleSrc, content);
    const hash = crypto.createHash('sha256').update(content).digest('hex');

    // Simulate an identical file already existing at destination
    const existingDestDir = path.join(destDir, 'Images', '2026', '10');
    fs.mkdirSync(existingDestDir, { recursive: true });
    fs.writeFileSync(path.join(existingDestDir, 'photo.jpg'), content);

    mockDb.files = [
      {
        id: 'file-1',
        filename: 'photo.jpg',
        relative_path: 'photo.jpg',
        root_path: sourceDir,
        extension: '.jpg',
        size_bytes: content.length,
        hash_sha256: hash,
        capture_time: '2026-10-17T10:00:00Z',
        is_missing: 0,
      },
    ];

    const preview = await generateOrganizationProposals({
      fileIds: ['file-1'],
      rulePattern: '{category}/{YYYY}/{MM}',
      destinationRoot: destDir,
    });

    expect(preview.totalFiles).toBe(1);
    expect(preview.proposals[0].is_identical_duplicate).toBe(true);
    expect(preview.estimatedDuplicatesAvoided).toBe(1);
  });

  // ── Verified Copy Execution ────────────────────────────────────────────────

  it('executes atomic verified copy preserving source file immutability', async () => {
    const srcFile = path.join(sourceDir, 'original_document.pdf');
    const srcContent = 'Critical business contract that must never be modified or deleted.';
    fs.writeFileSync(srcFile, srcContent, 'utf-8');

    const targetDestDir = path.join(destDir, 'Documents', '2026');
    const targetFile = path.join(targetDestDir, 'original_document.pdf');

    const result = await executeOrganization(
      [{ sourcePath: srcFile, destinationPath: targetFile }],
      destDir,
      'Test Organization'
    );

    expect(result.success).toBe(true);
    expect(result.completedFiles).toBe(1);
    expect(result.failedFiles).toBe(0);

    // Destination file exists and matches source
    expect(fs.existsSync(targetFile)).toBe(true);
    expect(fs.readFileSync(targetFile, 'utf-8')).toBe(srcContent);

    // CRITICAL: Original source file must remain intact and unmodified!
    expect(fs.existsSync(srcFile)).toBe(true);
    expect(fs.readFileSync(srcFile, 'utf-8')).toBe(srcContent);
  });

  // ── Filename Token Intelligence & Patterns ───────────────────────────────

  it('correctly resolves filename prefix, suffix, and title tokens', () => {
    const file1 = {
      filename: 'Family_2026_02.jpg',
      extension: '.jpg',
      capture_time: '2026-02-15T12:00:00Z',
    };
    const res1 = resolveOrganizationPath(file1, 'Images/{prefix}/{YYYY}/{suffix}');
    expect(res1.relativeFolder).toBe(path.join('Images', 'Family', '2026', '02'));

    const file2 = {
      filename: 'Invoice_CompanyA.pdf',
      extension: '.pdf',
      doc_title: 'Quarterly Invoice',
      file_created_at: '2026-01-10T09:00:00Z',
    };
    const res2 = resolveOrganizationPath(file2, 'Documents/{prefix}/{suffix}');
    expect(res2.relativeFolder).toBe(path.join('Documents', 'Invoice', 'CompanyA'));

    const res3 = resolveOrganizationPath(file2, 'Documents/Invoices/{title}');
    expect(res3.relativeFolder).toBe(path.join('Documents', 'Invoices', 'Quarterly Invoice'));
  });

  it('correctly resolves media and event tokens with deterministic fallbacks', () => {
    const file = {
      filename: 'Manali_Trip.mp4',
      extension: '.mp4',
      file_modified_at: '2025-06-20T14:30:00Z',
    };
    const res = resolveOrganizationPath(file, 'Videos/{YYYY}/{event}', null, 'Manali Trip');
    expect(res.relativeFolder).toBe(path.join('Videos', '2025', 'Manali Trip'));
  });
});

