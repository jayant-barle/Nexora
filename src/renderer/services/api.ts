// ============================================================================
// Nexora — Electron API Bridge
// Type-safe access to preload APIs from renderer
// ============================================================================

import type { ElectronAPI } from '../../preload/index';

// Access the API exposed via contextBridge
function getAPI(): ElectronAPI {
  const api = (window as unknown as { electronAPI: ElectronAPI }).electronAPI;
  if (!api) {
    throw new Error('electronAPI not available. Running outside Electron?');
  }
  return api;
}

// Create a mock API for browser development
function createMockAPI(): ElectronAPI {
  return {
    fs: {
      listDrives: async () => [
        { letter: 'C:', label: 'System', type: 'Local Disk', totalSize: 500e9, freeSpace: 200e9, usedSpace: 300e9 },
        { letter: 'D:', label: 'Data', type: 'Local Disk', totalSize: 1e12, freeSpace: 600e9, usedSpace: 400e9 },
      ],
      listDirectory: async (dirPath: string) => ({
        path: dirPath,
        entries: [],
        totalCount: 0,
      }),
      getFileInfo: async () => null,
      openFile: async () => '',
      revealInExplorer: async () => true,
    },
    db: {
      getStats: async () => ({
        totalFiles: 0,
        totalImages: 0,
        totalVideos: 0,
        totalPeople: 0,
        reviewedPeople: 0,
        unreviewedPeople: 0,
        duplicateGroups: 0,
        activeJobs: 0,
        pendingJobs: 0,
        failedJobs: 0,
        totalIndexedSize: 0,
        recentActivity: [],
        watchedFolders: 0,
      }),
    },
    search: {
      query: async () => ({ files: [], totalCount: 0, query: {}, executionTimeMs: 0 }),
    },
    jobs: {
      list: async () => [],
      create: async () => ({ id: '', type: '', status: 'queued', priority: 5, progress: 0, total: 0, target_path: null, target_id: null, config_json: null, error_message: null, retry_count: 0, max_retries: 3, started_at: null, completed_at: null, created_at: '', updated_at: '' }),
      cancel: async () => true,
      pause: async () => true,
      resume: async () => true,
    },
    people: {
      list: async () => [],
      update: async () => true,
      delete: async () => true,
    },
    roots: {
      list: async () => [],
      add: async () => ({ id: '', path: '', label: '', type: 'indexed' as const, active: true, created_at: '', updated_at: '' }),
    },
    watcher: {
      list: async () => [],
      add: async () => ({ id: '', path: '', label: '', active: true, auto_index: true, auto_organize: false, exclude_patterns: '[]', last_scan_at: null, created_at: '', updated_at: '' }),
      remove: async () => true,
      toggle: async () => true,
    },
    duplicates: {
      list: async () => [],
    },
    settings: {
      getAll: async () => ({}),
      get: async () => null,
      set: async () => true,
    },
    dialog: {
      openFolder: async () => null,
      openFile: async () => null,
    },
    app: {
      getVersion: async () => '0.1.0',
      getPaths: async () => ({
        userData: '', appData: '', temp: '', home: '', documents: '',
      }),
    },
    on: () => {},
    removeAllListeners: () => {},
  };
}

// Export a singleton — uses real API in Electron, mock in browser
let _api: ElectronAPI | null = null;

export function api(): ElectronAPI {
  if (!_api) {
    try {
      _api = getAPI();
    } catch {
      console.warn('Running outside Electron — using mock API');
      _api = createMockAPI();
    }
  }
  return _api;
}
