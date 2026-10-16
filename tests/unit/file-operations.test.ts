// ============================================================================
// Unit Tests: Safe File Operations, Verification, Collision & Undo Protection
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock database layer for isolated unit testing of batch operations & rollback
const operationsMap = new Map<string, any>();
const operationItemsMap = new Map<string, any>();
const historyList: any[] = [];

vi.mock('../../src/main/database', () => {
  return {
    getDb: () => ({
      prepare: (sql: string) => ({
        run: (...params: any[]) => {
          if (sql.includes('INSERT INTO copy_operations')) {
            const [id, type, status, source_description, destination_root, total_files, total_bytes, created_at] = params;
            operationsMap.set(id, { id, type, status, source_description, destination_root, total_files, total_bytes, created_at });
          } else if (sql.includes('INSERT INTO operation_items')) {
            const [id, operation_id, source_path, destination_path, file_size, created_at] = params;
            operationItemsMap.set(id, { id, operation_id, source_path, destination_path, file_size, status: 'pending', created_at });
          } else if (sql.includes('UPDATE operation_items')) {
            const [source_hash, destination_hash, status, error_message, id] = params;
            const item = operationItemsMap.get(id);
            if (item) {
              item.source_hash = source_hash;
              item.destination_hash = destination_hash;
              item.status = status;
              item.error_message = error_message;
            }
          } else if (sql.includes('UPDATE copy_operations SET status = ?')) {
            const id = params[params.length - 1];
            const op = operationsMap.get(id);
            if (op) {
              op.status = params[0];
              if (params.length > 2) {
                op.completed_files = params[1];
                op.failed_files = params[2];
              }
            }
          } else if (sql.includes('INSERT INTO operation_history')) {
            historyList.push(params);
          }
          return { changes: 1 };
        },
        get: (id: string) => operationsMap.get(id),
        all: (opId: string, status: string) => {
          return Array.from(operationItemsMap.values()).filter(it => it.operation_id === opId && it.status === status);
        },
      }),
    }),
  };
});

import {
  computeFileSha256,
  copyFileWithVerification,
  resolveSafeDestinationPath,
  validateDestinationRoot,
  executeBatchCopyOperation,
  revertBatchOperation,
} from '../../src/main/file-operations';

describe('Safe File Operations & Rollback Engine', () => {
  let tempDir: string;
  let sourceFile: string;
  let sourceContent: string;
  let sourceHash: string;

  beforeEach(async () => {
    operationsMap.clear();
    operationItemsMap.clear();
    historyList.length = 0;

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexora-test-ops-'));
    sourceFile = path.join(tempDir, 'sample_photo.jpg');
    sourceContent = 'Simulated high-resolution photo buffer content ' + Date.now();
    fs.writeFileSync(sourceFile, sourceContent, 'utf-8');
    sourceHash = await computeFileSha256(sourceFile);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('computes deterministic SHA-256 hash for file', async () => {
    const hash = await computeFileSha256(sourceFile);
    expect(hash).toHaveLength(64);
    expect(hash).toBe(sourceHash);
  });

  it('guarantees source file immutability during copy operation', async () => {
    const destDir = path.join(tempDir, 'organized');
    const destFile = path.join(destDir, 'sample_photo.jpg');

    const copyRes = await copyFileWithVerification(sourceFile, destFile);
    expect(copyRes.success).toBe(true);
    expect(copyRes.sourceHash).toBe(sourceHash);
    expect(copyRes.destHash).toBe(sourceHash);

    // Source must remain 100% intact and unchanged
    expect(fs.existsSync(sourceFile)).toBe(true);
    const sourceAfter = fs.readFileSync(sourceFile, 'utf-8');
    expect(sourceAfter).toBe(sourceContent);
  });

  it('detects identical duplicates and avoids redundant copy', async () => {
    const destFile = path.join(tempDir, 'target.jpg');
    fs.copyFileSync(sourceFile, destFile);

    const collision = await resolveSafeDestinationPath(destFile, sourceHash);
    expect(collision.isIdenticalDuplicate).toBe(true);
    expect(collision.finalPath).toBe(destFile);
  });

  it('generates non-destructive collision-safe filenames when content differs', async () => {
    const destFile = path.join(tempDir, 'target.jpg');
    fs.writeFileSync(destFile, 'Different content', 'utf-8');

    const collision = await resolveSafeDestinationPath(destFile, sourceHash);
    expect(collision.isIdenticalDuplicate).toBe(false);
    expect(collision.finalPath).toBe(path.join(tempDir, 'target (1).jpg'));
  });

  it('validates destination directory and detects write permissions', () => {
    const validDir = path.join(tempDir, 'dest_valid');
    const res = validateDestinationRoot(validDir, 1024);
    expect(res.valid).toBe(true);
  });

  it('executes batch copy and rolls back safely without touching source file', async () => {
    const destDir = path.join(tempDir, 'batch_dest');
    const destFile = path.join(destDir, 'copied_photo.jpg');

    const result = await executeBatchCopyOperation('Test Batch Copy', destDir, [
      { sourcePath: sourceFile, destinationPath: destFile },
    ]);

    expect(result.success).toBe(true);
    expect(result.completedFiles).toBe(1);
    expect(fs.existsSync(destFile)).toBe(true);

    // Rollback the operation
    const rollback = await revertBatchOperation(result.operationId);
    expect(rollback.success).toBe(true);
    expect(rollback.revertedFiles).toBe(1);
    expect(rollback.protectedFiles).toHaveLength(0);

    // Copied file removed, but source file remains intact
    expect(fs.existsSync(destFile)).toBe(false);
    expect(fs.existsSync(sourceFile)).toBe(true);
    expect(fs.readFileSync(sourceFile, 'utf-8')).toBe(sourceContent);
  });

  it('protects modified managed copies from deletion during rollback', async () => {
    const destDir = path.join(tempDir, 'protect_dest');
    const destFile = path.join(destDir, 'photo_to_edit.jpg');

    const result = await executeBatchCopyOperation('Test Edit Protection', destDir, [
      { sourcePath: sourceFile, destinationPath: destFile },
    ]);
    expect(result.success).toBe(true);

    // User edits the destination file after copy
    fs.writeFileSync(destFile, 'User edited content in Photoshop/Lightroom', 'utf-8');

    // Attempt rollback
    const rollback = await revertBatchOperation(result.operationId);
    expect(rollback.success).toBe(true);
    // Modified file must be flagged as protected and NOT deleted!
    expect(rollback.protectedFiles).toContain(destFile);
    expect(rollback.revertedFiles).toBe(0);
    expect(fs.existsSync(destFile)).toBe(true);
    expect(fs.readFileSync(destFile, 'utf-8')).toBe('User edited content in Photoshop/Lightroom');
  });
});
