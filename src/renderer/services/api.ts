// ============================================================================
// Nexora — Electron API Bridge
// Type-safe access to preload APIs from renderer with mock fallback
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
      createFolder: async (_parentDir: string, _name: string) => ({ success: true }),
      renameEntry: async (_oldPath: string, _name: string) => ({ success: true }),
      trashItem: async (_targetPath: string) => ({ success: true }),
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
      integrity: async () => ({ ok: true, message: 'ok' }),
      vacuum: async () => true,
    },
    operations: {
      copy: async () => ({ operationId: 'mock-op', success: true, totalFiles: 0, completedFiles: 0, failedFiles: 0, errors: [] }),
      revert: async () => ({ operationId: 'mock-op', success: true, revertedFiles: 0, skippedFiles: 0, protectedFiles: [], errors: [] }),
      list: async () => [],
    },
    search: {
      query: async () => ({ files: [], totalCount: 0, query: {}, executionTimeMs: 0 }),
      rebuildIndex: async () => ({ success: true, indexedCount: 0 }),
    },
    jobs: {
      list: async () => [],
      create: async () => ({ id: '', type: '', status: 'queued', priority: 1, progress: 0, total: 0, target_path: null, target_id: null, config_json: null, error_message: null, retry_count: 0, max_retries: 3, started_at: null, completed_at: null, created_at: '', updated_at: '' }),
      cancel: async (_jobId: string) => true,
      pause: async (_jobId?: string) => true,
      resume: async (_jobId?: string) => true,
      retry: async (_jobId: string) => true,
      clearCompleted: async () => 0,
    },
    people: {
      list: async () => [],
      update: async () => true,
      delete: async () => true,
      merge: async () => true,
      separateFace: async () => ({ success: true }),
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
      getFiles: async () => [],
      resolve: async () => ({ success: true, filesAffected: 0, bytesReclaimed: 0 }),
    },
    ai: {
      getStatus: async () => ({ ok: true, capabilities: { pong: true, cv2: true, numpy: true, pil: false, offline_ready: true } }),
      getModelManifest: async () => ({ version: '1.0.0', offline_ready: true, models: [] }),
      classifyImage: async () => ({ top_classes: [], tags: [] }),
      extractOcr: async () => ({ text: '', confidence: 0 }),
    },
    llm: {
      getStatus: async () => ({
        state: 'unavailable',
        isAvailable: false,
        modelName: 'qwen3:4b',
        isModelReady: false,
        baseUrl: 'http://127.0.0.1:11434',
        errorMessage: 'Mock mode active',
      }),
      classify: async (req) => ({
        category: 'document',
        tags: ['mock', 'document'],
        summary: `Mock summary for ${req.filename}`,
        suggestedFolder: 'Documents',
        confidence: 0.9,
        modelUsed: 'mock',
        latencyMs: 50,
      }),
      recommendOrganization: async () => ({
        relativeFolder: 'Documents/Mock/2026',
        reasoning: 'Mock rule selection',
        ruleName: 'Mock Rule',
        warnings: [],
        modelUsed: 'mock',
        latencyMs: 50,
      }),
      translateQuery: async (q: string) => ({
        searchQuery: { text: q },
        explanation: 'Mock natural language query translation',
        modelUsed: 'mock',
        latencyMs: 10,
      }),
      cancel: async () => true,
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
    organizer: {
      getRules: async () => [],
      saveRule: async () => ({ id: 'mock', name: 'Mock', pattern: '{category}/{YYYY}', is_default: false, created_at: '', updated_at: '' }),
      generateProposals: async () => ({
        ruleId: 'mock',
        ruleName: 'Mock',
        pattern: '{category}/{YYYY}',
        totalFiles: 0,
        estimatedBytes: 0,
        duplicatesAvoided: 0,
        conflictCount: 0,
        warningsCount: 0,
        items: [],
      }),
      execute: async () => ({
        operationId: 'mock-organize',
        success: true,
        totalFiles: 0,
        completedFiles: 0,
        failedFiles: 0,
        errors: [],
      }),
      getStoredProposals: async () => [],
      saveProposals: async () => true,
      updateProposalStatus: async () => true,
      runAutoPipeline: async () => ({
        proposalsGenerated: 0,
        executed: false,
        warningsCount: 0,
        errors: [],
      }),
    },
    library: {
      reconcile: async () => ({ checkedCount: 0, missingCount: 0, restoredCount: 0 }),
      rescan: async () => ({ rootId: '', totalFound: 0, indexedNew: 0, updatedExisting: 0, reusedCached: 0, failedCount: 0, durationMs: 0 }),
    },
    system: {
      getHardwareMetrics: async () => ({
        totalMemoryBytes: 16 * 1024 * 1024 * 1024,
        freeMemoryBytes: 8 * 1024 * 1024 * 1024,
        usedMemoryBytes: 8 * 1024 * 1024 * 1024,
        memoryPressurePercent: 50,
        cpuCores: 8,
        cpuModel: 'Intel Core i7 (Simulated)',
        cpuLoadPercent: 25,
        gpuName: 'NVIDIA GeForce RTX (Simulated)',
        gpuVramBytes: 6 * 1024 * 1024 * 1024,
        accelerationProvider: 'CUDA' as const,
        isGpuAvailable: true,
        primaryDiskType: 'SSD' as const,
        activeJobCount: 0,
        detectedProfile: 'performance' as const,
        activeProfile: 'performance' as const,
        isThrottled: false,
        throttleReason: null,
      }),
      getQueueStats: async () => ({
        activeJobs: 0,
        queuedJobs: 0,
        pausedJobs: 0,
        failedJobs: 0,
        completedJobs: 0,
        pendingAiFiles: 0,
        isPaused: false,
        isWaitingForIdle: false,
        processingRatePerSec: 0,
      }),
      pauseAllJobs: async () => true,
      resumeAllJobs: async () => true,
    },
    app: {
      getVersion: async () => '0.5.0',
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
      _api = createMockAPI();
    }
  }
  return _api;
}
