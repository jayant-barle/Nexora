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
    createFolder: (parentDir: string, folderName: string) => ipcRenderer.invoke('fs:create-folder', parentDir, folderName),
    renameEntry: (oldPath: string, newName: string) => ipcRenderer.invoke('fs:rename-entry', oldPath, newName),
    trashItem: (targetPath: string) => ipcRenderer.invoke('fs:trash-item', targetPath),
  },

  // ── Database ────────────────────────────────────────────────────────────
  db: {
    getStats: () => ipcRenderer.invoke('db:get-stats'),
    integrity: () => ipcRenderer.invoke('db:integrity'),
    vacuum: () => ipcRenderer.invoke('db:vacuum'),
  },

  // ── Safe File Operations & Reversible Undo ──────────────────────────────
  operations: {
    copy: (sourceDescription: string, destinationRoot: string, items: Array<{ sourcePath: string; destinationPath: string }>) =>
      ipcRenderer.invoke('operations:copy', sourceDescription, destinationRoot, items),
    revert: (operationId: string) => ipcRenderer.invoke('operations:revert', operationId),
    list: (limit?: number) => ipcRenderer.invoke('operations:list', limit),
  },

  // ── Search ──────────────────────────────────────────────────────────────
  search: {
    query: (searchQuery: import('../shared/types').SearchQuery | Record<string, unknown>) =>
      ipcRenderer.invoke('search:query', searchQuery),
    rebuildIndex: () => ipcRenderer.invoke('search:rebuild-index'),
  },

  // ── Jobs ────────────────────────────────────────────────────────────────
  jobs: {
    list: (status?: string) => ipcRenderer.invoke('jobs:list', status),
    create: (type: string, targetPath?: string, targetId?: string, config?: Record<string, unknown>) =>
      ipcRenderer.invoke('jobs:create', type, targetPath, targetId, config),
    cancel: (jobId: string) => ipcRenderer.invoke('jobs:cancel', jobId),
    pause: (jobId?: string) => ipcRenderer.invoke('jobs:pause', jobId),
    resume: (jobId?: string) => ipcRenderer.invoke('jobs:resume', jobId),
    retry: (jobId: string) => ipcRenderer.invoke('jobs:retry', jobId),
    clearCompleted: () => ipcRenderer.invoke('jobs:clear-completed'),
  },

  // ── People ──────────────────────────────────────────────────────────────
  people: {
    list: (includeHidden?: boolean) => ipcRenderer.invoke('people:list', includeHidden),
    update: (personId: string, updates: Record<string, unknown>) =>
      ipcRenderer.invoke('people:update', personId, updates),
    delete: (personId: string) => ipcRenderer.invoke('people:delete', personId),
    merge: (targetPersonId: string, sourcePersonIds: string[]) =>
      ipcRenderer.invoke('people:merge', targetPersonId, sourcePersonIds),
    separateFace: (personId: string, faceDetectionId: string, newPersonName?: string) =>
      ipcRenderer.invoke('people:separate-face', personId, faceDetectionId, newPersonName),
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
    getFiles: (groupId: string) => ipcRenderer.invoke('duplicates:get-files', groupId),
    resolve: (groupId: string, action: 'keep_best' | 'recycle' | 'hardlink') =>
      ipcRenderer.invoke('duplicates:resolve', groupId, action),
  },

  // ── AI Worker Status & Offline Models ───────────────────────────────────
  ai: {
    getStatus: () => ipcRenderer.invoke('ai:get-status'),
    getModelManifest: () => ipcRenderer.invoke('ai:get-model-manifest'),
    classifyImage: (filePath: string) => ipcRenderer.invoke('ai:classify-image', filePath),
    extractOcr: (filePath: string) => ipcRenderer.invoke('ai:extract-ocr', filePath),
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

  // ── Metadata Organization ──────────────────────────────────────────────
  organizer: {
    getRules: () => ipcRenderer.invoke('organizer:get-rules'),
    saveRule: (rule: import('../shared/types').OrganizationRule | Partial<import('../shared/types').OrganizationRule>) =>
      ipcRenderer.invoke('organizer:save-rule', rule),
    generateProposals: (fileIds: string[], ruleIdOrPattern: string, destinationRoot: string) =>
      ipcRenderer.invoke('organizer:generate-proposals', fileIds, ruleIdOrPattern, destinationRoot),
    execute: (proposals: import('../shared/types').OrganizationProposalItem[], destinationRoot: string, options?: { removeSourceOnSuccess?: boolean }) =>
      ipcRenderer.invoke('organizer:execute', proposals, destinationRoot, options),
    getStoredProposals: (status?: string, limit?: number) =>
      ipcRenderer.invoke('organizer:get-stored-proposals', status, limit),
    runAutoPipeline: (rootIdOrPath?: string, destinationRootOverride?: string) =>
      ipcRenderer.invoke('organizer:run-auto-pipeline', rootIdOrPath, destinationRootOverride),
  },

  // ── Library ─────────────────────────────────────────────────────────────
  library: {
    reconcile: (rootId?: string) => ipcRenderer.invoke('library:reconcile', rootId),
    rescan: (targetPath: string, fullRescan?: boolean) => ipcRenderer.invoke('library:rescan', targetPath, fullRescan),
  },

  // ── System & Adaptive Resources ────────────────────────────────────────
  system: {
    getHardwareMetrics: () => ipcRenderer.invoke('system:get-hardware-metrics'),
    getQueueStats: () => ipcRenderer.invoke('system:get-queue-stats'),
    pauseAllJobs: () => ipcRenderer.invoke('system:pause-all-jobs'),
    resumeAllJobs: () => ipcRenderer.invoke('system:resume-all-jobs'),
  },

  // ── App ─────────────────────────────────────────────────────────────────
  app: {
    getVersion: () => ipcRenderer.invoke('app:get-version'),
    getPaths: () => ipcRenderer.invoke('app:get-paths'),
  },

  // ── Events from main process ────────────────────────────────────────────
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const validChannels = [
      'job:progress',
      'job:completed',
      'job:cancelled',
      'job:error',
      'queue:status-changed',
      'watcher:change',
      'app:update'
    ];
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
