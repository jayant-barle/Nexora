// ============================================================================
// AI File Manager — IPC Handlers
// Secure bridge between renderer and main process
// ============================================================================

import { ipcMain, dialog, shell, BrowserWindow, app } from 'electron';
import path from 'path';
import * as db from './database';
import * as fsService from './filesystem';

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
    const validPath = validatePath(filePath);
    shell.showItemInFolder(validPath);
    return true;
  });

  // ── Database / Stats ─────────────────────────────────────────────────────

  ipcMain.handle('db:get-stats', async () => {
    return db.getDashboardStats();
  });

  // ── Search ────────────────────────────────────────────────────────────────

  ipcMain.handle('search:query', async (_event, query: unknown) => {
    if (!query || typeof query !== 'object') {
      throw new Error('Invalid search query');
    }
    return db.searchFiles(query as import('../shared/types').SearchQuery);
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
    db.updateJobStatus(id, 'cancelled');
    return true;
  });

  ipcMain.handle('jobs:pause', async (_event, jobId: unknown) => {
    const id = validateId(jobId);
    db.updateJobStatus(id, 'paused');
    return true;
  });

  ipcMain.handle('jobs:resume', async (_event, jobId: unknown) => {
    const id = validateId(jobId);
    db.updateJobStatus(id, 'queued');
    return true;
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
    return db.addWatchRoot(validPath, validLabel);
  });

  ipcMain.handle('watcher:remove', async (_event, watchId: unknown) => {
    const id = validateId(watchId);
    db.getDb().prepare('DELETE FROM watch_roots WHERE id = ?').run(id);
    return true;
  });

  ipcMain.handle('watcher:toggle', async (_event, watchId: unknown, active: unknown) => {
    const id = validateId(watchId);
    db.getDb().prepare('UPDATE watch_roots SET active = ?, updated_at = datetime(\'now\') WHERE id = ?').run(active ? 1 : 0, id);
    return true;
  });

  // ── Duplicates ────────────────────────────────────────────────────────────

  ipcMain.handle('duplicates:list', async () => {
    return db.getDuplicateGroups();
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
