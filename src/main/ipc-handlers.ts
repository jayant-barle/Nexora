// ============================================================================
// Nexora — IPC Handlers
// Secure bridge between renderer and main process
// ============================================================================

import { ipcMain, dialog, shell, BrowserWindow, app } from 'electron';
import path from 'path';
import fs from 'fs';
import * as db from './database';
import * as fsService from './filesystem';
import { getJobRunner } from './job-runner';
import { getHardwareMonitor } from './hardware-monitor';
import { getWatcherService } from './watcher';
import { getAiWorkerClient } from './ai-worker-client';
import { executeBatchCopyOperation, revertBatchOperation, CopyItem } from './file-operations';
import { getOrganizationRules, saveOrganizationRule, generateOrganizationProposals, executeOrganization } from './organizer';
import { reconcileLibrary, indexFolderIncremental } from './indexer';
import type { OrganizationRule, OrganizationProposalItem } from '../shared/types';

// ─── Input Validation ────────────────────────────────────────────────────────

function validatePath(inputPath: unknown): string {
  if (typeof inputPath !== 'string' || inputPath.length === 0) {
    throw new Error('Invalid path: must be a non-empty string');
  }
  // Normalize and prevent path traversal from managed areas
  const normalized = path.normalize(inputPath);
  if (normalized.includes('\0')) {
    throw new Error('Invalid path: contains null bytes');
  }
  return normalized;
}

function validateString(value: unknown, name: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Invalid ${name}: must be a string`);
  }
  return value;
}

function validateId(value: unknown): string {
  const str = validateString(value, 'id');
  if (!/^[a-f0-9-]{36}$/i.test(str) && !/^[a-zA-Z0-9_-]+$/.test(str)) {
    throw new Error('Invalid ID format');
  }
  return str;
}

// ─── Register All IPC Handlers ───────────────────────────────────────────────

export function registerIpcHandlers(): void {
  // ── Filesystem ───────────────────────────────────────────────────────────
  
  ipcMain.handle('fs:list-drives', async () => {
    return fsService.listDrives();
  });

  ipcMain.handle('fs:list-directory', async (_event, dirPath: unknown, options?: unknown) => {
    const validPath = validatePath(dirPath);
    return fsService.listDirectory(validPath, options as Record<string, unknown>);
  });

  ipcMain.handle('fs:get-file-info', async (_event, filePath: unknown) => {
    const validPath = validatePath(filePath);
    return fsService.getFileInfo(validPath);
  });

  ipcMain.handle('fs:open-file', async (_event, filePath: unknown) => {
    const validPath = validatePath(filePath);
    return shell.openPath(validPath);
  });

  ipcMain.handle('fs:reveal-in-explorer', async (_event, filePath: unknown) => {
    let validPath = validatePath(filePath);
    if (!path.isAbsolute(validPath)) {
      const resolved = db.resolveFileFullPath(validPath);
      if (resolved) validPath = resolved;
    }
    if (fs.existsSync(validPath)) {
      shell.showItemInFolder(validPath);
    } else {
      shell.openPath(path.dirname(validPath));
    }
    return true;
  });

  // ── Database / Maintenance ───────────────────────────────────────────────

  ipcMain.handle('db:get-stats', async () => {
    return db.getDashboardStats();
  });

  ipcMain.handle('db:integrity', async () => {
    return db.checkDatabaseIntegrity();
  });

  ipcMain.handle('db:vacuum', async () => {
    return db.vacuumDatabase();
  });

  // ── Search ────────────────────────────────────────────────────────────────

  ipcMain.handle('search:query', async (_event, query: unknown) => {
    if (!query || typeof query !== 'object') {
      throw new Error('Invalid search query');
    }
    return db.searchFiles(query as import('../shared/types').SearchQuery);
  });

  ipcMain.handle('search:rebuild-index', async () => {
    return db.rebuildSearchIndex();
  });

  // ── Jobs ──────────────────────────────────────────────────────────────────

  ipcMain.handle('jobs:list', async (_event, status?: unknown) => {
    const statusStr = status ? validateString(status, 'status') : undefined;
    return db.getJobs(statusStr);
  });

  ipcMain.handle('jobs:create', async (_event, type: unknown, targetPath?: unknown, targetId?: unknown, config?: unknown) => {
    const typeStr = validateString(type, 'type');
    const pathStr = targetPath ? validatePath(targetPath) : undefined;
    const idStr = targetId ? validateString(targetId, 'targetId') : undefined;
    return db.createJob(typeStr, pathStr, idStr, config as Record<string, unknown> | undefined);
  });

  ipcMain.handle('jobs:cancel', async (_event, jobId: unknown) => {
    const id = validateId(jobId);
    getJobRunner().cancel(id);
    return true;
  });

  ipcMain.handle('jobs:pause', async (_event, jobId?: unknown) => {
    if (jobId) {
      const id = validateId(jobId);
      db.updateJobStatus(id, 'paused');
    } else {
      getJobRunner().pause();
    }
    return true;
  });

  ipcMain.handle('jobs:resume', async (_event, jobId?: unknown) => {
    if (jobId) {
      const id = validateId(jobId);
      db.updateJobStatus(id, 'queued');
    }
    getJobRunner().resume();
    return true;
  });

  ipcMain.handle('jobs:retry', async (_event, jobId: unknown) => {
    const id = validateId(jobId);
    return getJobRunner().retry(id);
  });

  ipcMain.handle('jobs:clear-completed', async () => {
    return getJobRunner().clearCompleted();
  });

  // ── Safe File Operations & Rollback ───────────────────────────────────────

  ipcMain.handle('operations:copy', async (_event, sourceDescription: unknown, destinationRoot: unknown, items: unknown) => {
    const desc = validateString(sourceDescription, 'sourceDescription');
    const dest = validatePath(destinationRoot);
    if (!Array.isArray(items)) {
      throw new Error('Invalid items: must be an array of CopyItem');
    }
    const copyItems: CopyItem[] = items.map((i) => ({
      sourcePath: validatePath(i.sourcePath),
      destinationPath: validatePath(i.destinationPath),
    }));
    return executeBatchCopyOperation(desc, dest, copyItems);
  });

  ipcMain.handle('operations:revert', async (_event, operationId: unknown) => {
    const id = validateId(operationId);
    return revertBatchOperation(id);
  });

  ipcMain.handle('operations:list', async (_event, limit?: unknown) => {
    const l = typeof limit === 'number' && limit > 0 ? limit : 100;
    return db.getCopyOperations(l);
  });

  // ── People ────────────────────────────────────────────────────────────────

  ipcMain.handle('people:list', async (_event, includeHidden?: unknown) => {
    return db.getPeople(!!includeHidden);
  });

  ipcMain.handle('people:update', async (_event, personId: unknown, updates: unknown) => {
    const id = validateId(personId);
    const database = db.getDb();
    if (updates && typeof updates === 'object') {
      const u = updates as Record<string, unknown>;
      const sets: string[] = [];
      const params: unknown[] = [];
      
      if ('name' in u && typeof u.name === 'string') { sets.push('name = ?'); params.push(u.name); }
      if ('is_hidden' in u) { sets.push('is_hidden = ?'); params.push(u.is_hidden ? 1 : 0); }
      if ('is_excluded' in u) { sets.push('is_excluded = ?'); params.push(u.is_excluded ? 1 : 0); }
      if ('review_status' in u && typeof u.review_status === 'string') { sets.push('review_status = ?'); params.push(u.review_status); }
      
      if (sets.length > 0) {
        sets.push("updated_at = datetime('now')");
        params.push(id);
        database.prepare(`UPDATE people SET ${sets.join(', ')} WHERE id = ?`).run(...params);
      }
    }
    return true;
  });

  ipcMain.handle('people:merge', async (_event, targetPersonId: unknown, sourcePersonIds: unknown) => {
    const targetId = validateId(targetPersonId);
    if (!Array.isArray(sourcePersonIds)) {
      throw new Error('sourcePersonIds must be an array');
    }
    const srcIds = sourcePersonIds.map((id) => validateId(id));
    return db.mergePeople(targetId, srcIds);
  });

  ipcMain.handle('people:delete', async (_event, personId: unknown) => {
    const id = validateId(personId);
    const database = db.getDb();
    database.prepare('DELETE FROM file_people WHERE person_id = ?').run(id);
    database.prepare('DELETE FROM face_clusters WHERE person_id = ?').run(id);
    database.prepare('DELETE FROM people WHERE id = ?').run(id);
    return true;
  });

  // ── Roots ─────────────────────────────────────────────────────────────────

  ipcMain.handle('roots:list', async () => {
    return db.getRoots();
  });

  ipcMain.handle('roots:add', async (_event, pathStr: unknown, label: unknown, type: unknown) => {
    const validPath = validatePath(pathStr);
    const validLabel = validateString(label, 'label');
    const validType = validateString(type, 'type') as 'indexed' | 'watched' | 'managed';
    return db.addRoot(validPath, validLabel, validType);
  });

  // ── Watch Roots ───────────────────────────────────────────────────────────

  ipcMain.handle('watcher:list', async () => {
    return db.getWatchRoots();
  });

  ipcMain.handle('watcher:add', async (_event, pathStr: unknown, label: unknown) => {
    const validPath = validatePath(pathStr);
    const validLabel = validateString(label, 'label');
    const root = db.addWatchRoot(validPath, validLabel);
    getWatcherService().attachWatcher(root.id, validPath);
    return root;
  });

  ipcMain.handle('watcher:remove', async (_event, watchId: unknown) => {
    const id = validateId(watchId);
    getWatcherService().detachWatcher(id);
    db.getDb().prepare('DELETE FROM watch_roots WHERE id = ?').run(id);
    return true;
  });

  ipcMain.handle('watcher:toggle', async (_event, watchId: unknown, active: unknown) => {
    const id = validateId(watchId);
    const row = db.getDb().prepare('SELECT path FROM watch_roots WHERE id = ?').get(id) as any;
    if (row) {
      getWatcherService().setWatcherActive(id, row.path, !!active);
    }
    db.getDb().prepare('UPDATE watch_roots SET active = ?, updated_at = datetime(\'now\') WHERE id = ?').run(active ? 1 : 0, id);
    return true;
  });

  // ── Duplicates ────────────────────────────────────────────────────────────

  ipcMain.handle('duplicates:list', async () => {
    return db.getDuplicateGroups();
  });

  ipcMain.handle('duplicates:get-files', async (_event, groupId: unknown) => {
    const gid = validateId(groupId);
    return db.getDuplicateGroupFiles(gid);
  });

  ipcMain.handle('duplicates:resolve', async (_event, groupId: unknown, action: unknown) => {
    const gid = validateId(groupId);
    const act = validateString(action, 'action') as 'keep_best' | 'recycle' | 'hardlink';
    if (!['keep_best', 'recycle', 'hardlink'].includes(act)) {
      throw new Error(`Invalid action: ${act}`);
    }
    return db.resolveDuplicateGroup(gid, act);
  });

  // ── Settings ──────────────────────────────────────────────────────────────

  ipcMain.handle('settings:get-all', async () => {
    return db.getSettings();
  });

  ipcMain.handle('settings:get', async (_event, key: unknown) => {
    const k = validateString(key, 'key');
    const settings = db.getSettings();
    return settings[k] ?? null;
  });

  ipcMain.handle('settings:set', async (_event, key: unknown, value: unknown) => {
    const k = validateString(key, 'key');
    const v = typeof value === 'string' ? value : JSON.stringify(value);
    db.setSetting(k, v);
    return true;
  });

  // ── AI Worker Status ──────────────────────────────────────────────────────

  ipcMain.handle('ai:get-status', async () => {
    try {
      const pingRes = await getAiWorkerClient().ping(3000);
      return { ok: true, capabilities: pingRes };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('ai:get-model-manifest', async () => {
    try {
      return await getAiWorkerClient().getModelManifest();
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('ai:classify-image', async (_event, filePath: unknown) => {
    const validPath = validatePath(filePath);
    return getAiWorkerClient().classifyImage(validPath);
  });

  ipcMain.handle('ai:extract-ocr', async (_event, filePath: unknown) => {
    const validPath = validatePath(filePath);
    return getAiWorkerClient().extractOcr(validPath);
  });

  // ── Dialogs ───────────────────────────────────────────────────────────────

  ipcMain.handle('dialog:open-folder', async () => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle('dialog:open-file', async (_event, filters?: unknown) => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: Array.isArray(filters) ? filters : undefined,
    });
    return result.canceled ? null : result.filePaths;
  });

  // ── Metadata Organization ──────────────────────────────────────────────
  ipcMain.handle('organizer:get-rules', async () => {
    return getOrganizationRules();
  });

  ipcMain.handle('organizer:save-rule', async (_event, rule: unknown) => {
    if (!rule || typeof rule !== 'object') throw new Error('Invalid rule payload');
    const r = rule as Partial<OrganizationRule>;
    if (!r.name || !r.pattern) throw new Error('Rule name and pattern are required');
    return saveOrganizationRule(r as any);
  });

  ipcMain.handle('organizer:generate-proposals', async (_event, fileIds: unknown, ruleIdOrPattern: unknown, destinationRoot: unknown) => {
    if (!Array.isArray(fileIds) || fileIds.length === 0) throw new Error('fileIds must be a non-empty array');
    const ruleStr = validateString(ruleIdOrPattern, 'ruleIdOrPattern');
    const dest = validatePath(destinationRoot);
    const validIds = fileIds.map((id) => validateString(id, 'fileId'));
    return generateOrganizationProposals(validIds, ruleStr, dest);
  });

  ipcMain.handle('organizer:execute', async (_event, proposals: unknown, destinationRoot: unknown, options?: unknown) => {
    if (!Array.isArray(proposals)) throw new Error('proposals must be an array');
    const dest = validatePath(destinationRoot);
    return executeOrganization(proposals as OrganizationProposalItem[], dest, options as any);
  });

  // ── Library Reconciliation & Rescan ─────────────────────────────────────
  ipcMain.handle('library:reconcile', async (_event, rootId?: unknown) => {
    const id = rootId ? validateString(rootId, 'rootId') : undefined;
    return reconcileLibrary(id);
  });

  ipcMain.handle('library:rescan', async (_event, targetPath: unknown, fullRescan?: unknown) => {
    const validPath = validatePath(targetPath);
    return indexFolderIncremental(validPath, { forceFullRescan: !!fullRescan });
  });

  // ── System & Adaptive Resource Management ──────────────────────────────
  ipcMain.handle('system:get-hardware-metrics', async () => {
    return getHardwareMonitor().getMetrics();
  });

  ipcMain.handle('system:get-queue-stats', async () => {
    return getJobRunner().getQueueStats();
  });

  ipcMain.handle('system:pause-all-jobs', async () => {
    getJobRunner().pauseAll();
    return true;
  });

  ipcMain.handle('system:resume-all-jobs', async () => {
    getJobRunner().resumeAll();
    return true;
  });

  // ── App Info ──────────────────────────────────────────────────────────────

  ipcMain.handle('app:get-version', async () => {
    return app.getVersion();
  });

  ipcMain.handle('app:get-paths', async () => {
    return {
      userData: app.getPath('userData'),
      appData: app.getPath('appData'),
      temp: app.getPath('temp'),
      home: app.getPath('home'),
      documents: app.getPath('documents'),
    };
  });
}
