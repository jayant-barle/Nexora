// ============================================================================
// Nexora — Preload Script (Secure Bridge)
// Exposes only approved APIs to the renderer via contextBridge
// ============================================================================

import { contextBridge, ipcRenderer } from 'electron';

// ─── Type-safe API exposed to renderer ───────────────────────────────────────

const electronAPI = {
  // ── Filesystem ──────────────────────────────────────────────────────────
  fs: {
    listDrives: () => ipcRenderer.invoke('fs:list-drives'),
    listDirectory: (dirPath: string, options?: Record<string, unknown>) =>
      ipcRenderer.invoke('fs:list-directory', dirPath, options),
    getFileInfo: (filePath: string) => ipcRenderer.invoke('fs:get-file-info', filePath),
    openFile: (filePath: string) => ipcRenderer.invoke('fs:open-file', filePath),
    revealInExplorer: (filePath: string) => ipcRenderer.invoke('fs:reveal-in-explorer', filePath),
  },

  // ── Database ────────────────────────────────────────────────────────────
  db: {
    getStats: () => ipcRenderer.invoke('db:get-stats'),
  },

  // ── Search ──────────────────────────────────────────────────────────────
  search: {
    query: (searchQuery: import('../shared/types').SearchQuery | Record<string, unknown>) =>
      ipcRenderer.invoke('search:query', searchQuery),
  },

  // ── Jobs ────────────────────────────────────────────────────────────────
  jobs: {
    list: (status?: string) => ipcRenderer.invoke('jobs:list', status),
    create: (type: string, targetPath?: string, targetId?: string, config?: Record<string, unknown>) =>
      ipcRenderer.invoke('jobs:create', type, targetPath, targetId, config),
    cancel: (jobId: string) => ipcRenderer.invoke('jobs:cancel', jobId),
    pause: (jobId: string) => ipcRenderer.invoke('jobs:pause', jobId),
    resume: (jobId: string) => ipcRenderer.invoke('jobs:resume', jobId),
  },

  // ── People ──────────────────────────────────────────────────────────────
  people: {
    list: (includeHidden?: boolean) => ipcRenderer.invoke('people:list', includeHidden),
    update: (personId: string, updates: Record<string, unknown>) =>
      ipcRenderer.invoke('people:update', personId, updates),
    delete: (personId: string) => ipcRenderer.invoke('people:delete', personId),
  },

  // ── Roots ───────────────────────────────────────────────────────────────
  roots: {
    list: () => ipcRenderer.invoke('roots:list'),
    add: (pathStr: string, label: string, type: string) =>
      ipcRenderer.invoke('roots:add', pathStr, label, type),
  },

  // ── Watch Roots ─────────────────────────────────────────────────────────
  watcher: {
    list: () => ipcRenderer.invoke('watcher:list'),
    add: (pathStr: string, label: string) => ipcRenderer.invoke('watcher:add', pathStr, label),
    remove: (watchId: string) => ipcRenderer.invoke('watcher:remove', watchId),
    toggle: (watchId: string, active: boolean) => ipcRenderer.invoke('watcher:toggle', watchId, active),
  },

  // ── Duplicates ──────────────────────────────────────────────────────────
  duplicates: {
    list: () => ipcRenderer.invoke('duplicates:list'),
  },

  // ── Settings ────────────────────────────────────────────────────────────
  settings: {
    getAll: () => ipcRenderer.invoke('settings:get-all'),
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value),
  },

  // ── Dialogs ─────────────────────────────────────────────────────────────
  dialog: {
    openFolder: () => ipcRenderer.invoke('dialog:open-folder'),
    openFile: (filters?: Array<{ name: string; extensions: string[] }>) =>
      ipcRenderer.invoke('dialog:open-file', filters),
  },

  // ── App ─────────────────────────────────────────────────────────────────
  app: {
    getVersion: () => ipcRenderer.invoke('app:get-version'),
    getPaths: () => ipcRenderer.invoke('app:get-paths'),
  },

  // ── Events from main process ────────────────────────────────────────────
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const validChannels = ['job:progress', 'job:completed', 'job:error', 'watcher:change', 'app:update'];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (_event, ...args) => callback(...args));
    }
  },
  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel);
  },
};

// Expose via contextBridge — renderer can access via window.electronAPI
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// Type export for use in renderer
export type ElectronAPI = typeof electronAPI;
