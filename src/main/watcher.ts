// ============================================================================
// Nexora — Filesystem Watcher Service
// Continuous directory monitoring, debounced event queue, and real-time UI sync
// ============================================================================

import chokidar, { FSWatcher } from 'chokidar';
import path from 'path';
import { BrowserWindow } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { getDb, createJob } from './database';

export class WatcherService {
  private watchers: Map<string, FSWatcher> = new Map();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private pendingChanges: Map<string, Set<string>> = new Map();

  public async init(): Promise<void> {
    const db = getDb();
    const activeRoots = db.prepare('SELECT * FROM watch_roots WHERE active = 1').all() as any[];

    for (const r of activeRoots) {
      this.attachWatcher(r.id, r.path);
    }
  }

  public attachWatcher(watchId: string, folderPath: string): void {
    if (this.watchers.has(watchId)) {
      this.detachWatcher(watchId);
    }

    try {
      const watcher = chokidar.watch(folderPath, {
        ignored: [
          /(^|[/\\])\../, // ignore dotfiles
          /node_modules/,
          /\$RECYCLE\.BIN/,
          /System Volume Information/,
          /\.tmp$/,
          /\.crdownload$/,
        ],
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 1000,
          pollInterval: 200,
        },
      });

      watcher.on('add', (filePath) => this.handleEvent(watchId, folderPath, 'add', filePath));
      watcher.on('change', (filePath) => this.handleEvent(watchId, folderPath, 'change', filePath));
      watcher.on('unlink', (filePath) => this.handleEvent(watchId, folderPath, 'unlink', filePath));

      watcher.on('error', (err) => {
        console.warn(`[Watcher] Error watching ${folderPath}:`, err);
      });

      this.watchers.set(watchId, watcher);
      console.log(`[Watcher] Attached real-time watcher to: ${folderPath}`);
    } catch (err) {
      console.error(`[Watcher] Failed to attach watcher to ${folderPath}:`, err);
    }
  }

  public detachWatcher(watchId: string): void {
    const watcher = this.watchers.get(watchId);
    if (watcher) {
      watcher.close().catch(() => {});
      this.watchers.delete(watchId);
    }
  }

  public setWatcherActive(watchId: string, folderPath: string, active: boolean): void {
    if (active) {
      this.attachWatcher(watchId, folderPath);
    } else {
      this.detachWatcher(watchId);
    }
  }

  public stopAll(): void {
    for (const watcher of this.watchers.values()) {
      watcher.close().catch(() => {});
    }
    this.watchers.clear();
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.pendingChanges.clear();
  }

  private handleEvent(watchId: string, rootPath: string, eventType: 'add' | 'change' | 'unlink', filePath: string): void {
    if (!this.pendingChanges.has(watchId)) {
      this.pendingChanges.set(watchId, new Set());
    }
    this.pendingChanges.get(watchId)!.add(filePath);

    // Debounce burst of changes (500ms sliding window)
    if (this.debounceTimers.has(watchId)) {
      clearTimeout(this.debounceTimers.get(watchId)!);
    }

    const timer = setTimeout(() => {
      this.flushChanges(watchId, rootPath);
    }, 500);

    this.debounceTimers.set(watchId, timer);
  }

  private flushChanges(watchId: string, rootPath: string): void {
    const changedFiles = Array.from(this.pendingChanges.get(watchId) || []);
    this.pendingChanges.delete(watchId);
    this.debounceTimers.delete(watchId);

    if (changedFiles.length === 0) return;

    console.log(`[Watcher] Detected ${changedFiles.length} file changes in ${rootPath}. Triggering incremental indexing job...`);

    // Queue incremental indexing scan job
    createJob('folder_scan', rootPath, watchId, { changedFilesCount: changedFiles.length });

    // Notify UI
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('watcher:change', {
          watchId,
          rootPath,
          changedCount: changedFiles.length,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }
}

// Singleton watcher service
let _watcherService: WatcherService | null = null;

export function getWatcherService(): WatcherService {
  if (!_watcherService) {
    _watcherService = new WatcherService();
  }
  return _watcherService;
}
