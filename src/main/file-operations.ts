// ============================================================================
// Nexora — Safe File Operations & Rollback Engine
// Copy-first preservation, SHA-256 verification, collision handling, and reversible undo
// ============================================================================

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from './database';
import { getFreeDiskSpace } from './filesystem';

export interface CopyItem {
  sourcePath: string;
  destinationPath: string;
}

export interface OperationResult {
  operationId: string;
  success: boolean;
  totalFiles: number;
  completedFiles: number;
  failedFiles: number;
  errors: Array<{ file: string; error: string }>;
}

export interface RevertResult {
  operationId: string;
  success: boolean;
  revertedFiles: number;
  skippedFiles: number;
  protectedFiles: string[]; // Files that were modified after copying and therefore preserved
  errors: string[];
}

// ─── Cryptographic Hash Utility ──────────────────────────────────────────────

export async function computeFileSha256(filePath: string): Promise<string> {
  const statBefore = await fs.promises.stat(filePath);
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', async () => {
      try {
        const statAfter = await fs.promises.stat(filePath);
        if (statBefore.size !== statAfter.size || statBefore.mtimeMs !== statAfter.mtimeMs) {
          return reject(new Error(`File modified during hashing: ${filePath}`));
        }
        resolve(hash.digest('hex'));
      } catch (err) {
        reject(err);
      }
    });
    stream.on('error', (err) => reject(err));
  });
}


// ─── Destination Validation & Collision Resolution ───────────────────────────

export function validateDestinationRoot(destRoot: string, requiredBytes: number): { valid: boolean; error?: string } {
  try {
    if (!fs.existsSync(destRoot)) {
      fs.mkdirSync(destRoot, { recursive: true });
    }
    fs.accessSync(destRoot, fs.constants.W_OK);

    const freeSpace = getFreeDiskSpace(destRoot);
    const safetyBuffer = 100 * 1024 * 1024; // 100 MB buffer
    if (freeSpace > 0 && freeSpace < requiredBytes + safetyBuffer) {
      return {
        valid: false,
        error: `Insufficient disk space: ${(freeSpace / 1e9).toFixed(2)} GB available, ${(requiredBytes / 1e9).toFixed(2)} GB required.`,
      };
    }

    return { valid: true };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : 'Cannot access destination folder' };
  }
}

export async function resolveSafeDestinationPath(destPath: string, sourceHash?: string): Promise<{ finalPath: string; isIdenticalDuplicate: boolean }> {
  if (!fs.existsSync(destPath)) {
    return { finalPath: destPath, isIdenticalDuplicate: false };
  }

  // File exists: compare hashes if sourceHash provided
  if (sourceHash) {
    try {
      const existingHash = await computeFileSha256(destPath);
      if (existingHash === sourceHash) {
        return { finalPath: destPath, isIdenticalDuplicate: true };
      }
    } catch {
      // Proceed to generate unique name
    }
  }

  // Generate numbered collision suffix (e.g. "photo (1).jpg")
  const dir = path.dirname(destPath);
  const ext = path.extname(destPath);
  const baseName = path.basename(destPath, ext);

  let counter = 1;
  while (true) {
    const candidateName = `${baseName} (${counter})${ext}`;
    const candidatePath = path.join(dir, candidateName);
    if (!fs.existsSync(candidatePath)) {
      return { finalPath: candidatePath, isIdenticalDuplicate: false };
    }
    counter++;
  }
}

// ─── Copy with Mandatory Pre/Post Hash Verification ──────────────────────────

export async function copyFileWithVerification(
  src: string,
  dest: string,
  knownSourceHash?: string
): Promise<{ success: boolean; sourceHash: string; destHash: string; error?: string }> {
  const destDir = path.dirname(dest);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  try {
    const statBefore = await fs.promises.stat(src);

    // 1. Pre-copy hash
    const sourceHash = knownSourceHash || (await computeFileSha256(src));

    // 2. Copy to temp file
    const tempPath = `${dest}.nexora-tmp-${Date.now()}`;
    try {
      await fs.promises.copyFile(src, tempPath);

      // Verify source was not modified during copy
      const statAfter = await fs.promises.stat(src);
      if (statBefore.size !== statAfter.size || statBefore.mtimeMs !== statAfter.mtimeMs) {
        await fs.promises.unlink(tempPath).catch(() => {});
        return {
          success: false,
          sourceHash,
          destHash: '',
          error: `Source file modified during copy operation: ${src}`,
        };
      }

      // 3. Post-copy hash verification
      const destHash = await computeFileSha256(tempPath);
      if (sourceHash !== destHash) {
        await fs.promises.unlink(tempPath).catch(() => {});
        return {
          success: false,
          sourceHash,
          destHash,
          error: 'Integrity check failed: source and destination SHA-256 hashes do not match',
        };
      }

      // 4. Atomic rename to final destination
      await fs.promises.rename(tempPath, dest);
      return { success: true, sourceHash, destHash };
    } catch (err) {
      await fs.promises.unlink(tempPath).catch(() => {});
      return {
        success: false,
        sourceHash,
        destHash: '',
        error: err instanceof Error ? err.message : 'Unknown error during copy',
      };
    }
  } catch (err) {
    return {
      success: false,
      sourceHash: '',
      destHash: '',
      error: err instanceof Error ? err.message : `Failed to access source file: ${src}`,
    };
  }
}

// ─── Batch Operation Execution with Database Journaling ──────────────────────

export async function executeBatchCopyOperation(
  sourceDescription: string,
  destinationRoot: string,
  items: CopyItem[],
  onProgress?: (completed: number, total: number) => void
): Promise<OperationResult> {
  const db = getDb();
  const operationId = uuidv4();
  const now = new Date().toISOString();

  let totalBytes = 0;
  for (const item of items) {
    try {
      totalBytes += fs.statSync(item.sourcePath).size;
    } catch {
      // Ignored
    }
  }

  // 1. Destination validation
  const validation = validateDestinationRoot(destinationRoot, totalBytes);
  if (!validation.valid) {
    throw new Error(`Destination validation failed: ${validation.error}`);
  }

  // 2. Register operation in database
  db.prepare(`
    INSERT INTO copy_operations (id, type, status, source_description, destination_root, total_files, total_bytes, created_at)
    VALUES (?, 'batch_copy', 'in_progress', ?, ?, ?, ?, ?)
  `).run(operationId, sourceDescription, destinationRoot, items.length, totalBytes, now);

  const insertItemStmt = db.prepare(`
    INSERT INTO operation_items (id, operation_id, source_path, destination_path, file_size, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?)
  `);

  const updateItemStmt = db.prepare(`
    UPDATE operation_items SET source_hash = ?, destination_hash = ?, status = ?, error_message = ? WHERE id = ?
  `);

  const itemRecords: Array<{ id: string; source: string; dest: string; size: number }> = [];

  for (const item of items) {
    const itemId = uuidv4();
    let size = 0;
    try {
      size = fs.statSync(item.sourcePath).size;
    } catch {}
    insertItemStmt.run(itemId, operationId, item.sourcePath, item.destinationPath, size, now);
    itemRecords.push({ id: itemId, source: item.sourcePath, dest: item.destinationPath, size });
  }

  let completedFiles = 0;
  let failedFiles = 0;
  let copiedBytes = 0;
  const errors: Array<{ file: string; error: string }> = [];

  // 3. Process each item
  for (let i = 0; i < itemRecords.length; i++) {
    const item = itemRecords[i];
    try {
      const { finalPath, isIdenticalDuplicate } = await resolveSafeDestinationPath(item.dest);

      if (isIdenticalDuplicate) {
        updateItemStmt.run('', '', 'skipped_identical', null, item.id);
        completedFiles++;
      } else {
        const copyRes = await copyFileWithVerification(item.source, finalPath);
        if (copyRes.success) {
          updateItemStmt.run(copyRes.sourceHash, copyRes.destHash, 'completed', null, item.id);
          completedFiles++;
          copiedBytes += item.size;
        } else {
          updateItemStmt.run(copyRes.sourceHash, copyRes.destHash, 'failed', copyRes.error, item.id);
          failedFiles++;
          errors.push({ file: item.source, error: copyRes.error || 'Copy failed' });
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      updateItemStmt.run(null, null, 'failed', errMsg, item.id);
      failedFiles++;
      errors.push({ file: item.source, error: errMsg });
    }

    if (onProgress) {
      onProgress(i + 1, itemRecords.length);
    }
  }

  // 4. Update final operation status
  const finalStatus = failedFiles === 0 ? 'completed' : completedFiles > 0 ? 'partially_completed' : 'failed';
  db.prepare(`
    UPDATE copy_operations SET status = ?, completed_files = ?, failed_files = ?, copied_bytes = ?, completed_at = datetime('now')
    WHERE id = ?
  `).run(finalStatus, completedFiles, failedFiles, copiedBytes, operationId);

  // 5. Record in operation_history for HistoryPage
  db.prepare(`
    INSERT INTO operation_history (id, operation_type, description, details_json, is_undoable, status)
    VALUES (?, 'batch_copy', ?, ?, 1, ?)
  `).run(
    uuidv4(),
    `Copied ${completedFiles} files to ${path.basename(destinationRoot)}`,
    JSON.stringify({ operationId, completedFiles, failedFiles, totalBytes }),
    finalStatus
  );

  return {
    operationId,
    success: failedFiles === 0,
    totalFiles: items.length,
    completedFiles,
    failedFiles,
    errors,
  };
}

// ─── Reversible Rollback Engine ──────────────────────────────────────────────

export async function revertBatchOperation(operationId: string): Promise<RevertResult> {
  const db = getDb();

  const op = db.prepare('SELECT * FROM copy_operations WHERE id = ?').get(operationId) as any;
  if (!op) {
    throw new Error(`Operation ${operationId} not found`);
  }

  if (op.status === 'reverted') {
    throw new Error(`Operation ${operationId} has already been reverted`);
  }

  const items = db.prepare('SELECT * FROM operation_items WHERE operation_id = ? AND status = ?').all(operationId, 'completed') as any[];

  let revertedFiles = 0;
  let skippedFiles = 0;
  const protectedFiles: string[] = [];
  const errors: string[] = [];

  for (const item of items) {
    const destPath = item.destination_path;
    const expectedHash = item.destination_hash;

    try {
      if (!fs.existsSync(destPath)) {
        skippedFiles++;
        continue;
      }

      // Check if user has modified the file since copy
      const currentHash = await computeFileSha256(destPath);
      if (currentHash !== expectedHash) {
        // User modified the file! PROTECT IT from deletion!
        protectedFiles.push(destPath);
        skippedFiles++;
        continue;
      }

      // File is unmodified copy: safe to delete
      await fs.promises.unlink(destPath);
      revertedFiles++;
    } catch (err) {
      errors.push(`Failed to remove ${destPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Update operation status
  db.prepare(`
    UPDATE copy_operations SET status = 'reverted', completed_at = datetime('now') WHERE id = ?
  `).run(operationId);

  // Log rollback in operation_history
  db.prepare(`
    INSERT INTO operation_history (id, operation_type, description, details_json, is_undoable, status)
    VALUES (?, 'rollback', ?, ?, 0, 'completed')
  `).run(
    uuidv4(),
    `Rolled back operation ${operationId.substring(0, 8)} (${revertedFiles} files removed, ${protectedFiles.length} protected)`,
    JSON.stringify({ operationId, revertedFiles, protectedFiles, errors })
  );

  return {
    operationId,
    success: errors.length === 0,
    revertedFiles,
    skippedFiles,
    protectedFiles,
    errors,
  };
}
