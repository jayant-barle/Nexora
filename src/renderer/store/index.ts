// ============================================================================
// Nexora — Global Store (Zustand)
// ============================================================================

import { create } from 'zustand';
import type { NavigationPage, DashboardStats, DirectoryEntry, DriveInfo, Job, JobQueueStats, Person, WatchRoot, Root } from '../../shared/types';
import { api } from '../services/api';

// ─── Navigation Store ────────────────────────────────────────────────────────

interface NavigationState {
  currentPage: NavigationPage;
  sidebarCollapsed: boolean;
  setPage: (page: NavigationPage) => void;
  toggleSidebar: () => void;
}

export const useNavigationStore = create<NavigationState>((set) => ({
  currentPage: 'dashboard',
  sidebarCollapsed: false,
  setPage: (page) => set({ currentPage: page }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
}));

// ─── Dashboard Store ─────────────────────────────────────────────────────────

interface DashboardState {
  stats: DashboardStats | null;
  loading: boolean;
  error: string | null;
  fetchStats: () => Promise<void>;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  stats: null,
  loading: false,
  error: null,
  fetchStats: async () => {
    set({ loading: true, error: null });
    try {
      const stats = await api().db.getStats();
      set({ stats, loading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to load stats', loading: false });
    }
  },
}));

// ─── Explorer Store ──────────────────────────────────────────────────────────

// ─── Explorer Store ──────────────────────────────────────────────────────────

export interface ExplorerTab {
  id: string;
  title: string;
  path: string;
  page?: NavigationPage;
  icon?: string;
  history: string[];
  historyIndex: number;
}

export interface DetailedEntry extends DirectoryEntry {
  indexed?: any;
}

interface ExplorerState {
  currentPath: string;
  entries: DirectoryEntry[];
  drives: DriveInfo[];
  roots: Root[];
  userPaths: { desktop?: string; downloads?: string; documents?: string; pictures?: string; home?: string };
  selectedFiles: Set<string>;
  focusedIndex: number;
  viewMode: 'details' | 'grid' | 'list';
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  loading: boolean;
  error: string | null;
  history: string[];
  historyIndex: number;
  searchFilter: string;
  detailsPaneOpen: boolean;
  activeFileDetails: DetailedEntry | null;
  clipboard: { items: string[]; action: 'copy' | 'cut' } | null;
  tabs: ExplorerTab[];
  activeTabId: string;
  
  // Navigation & Core Actions
  setPath: (path: string) => void;
  navigateTo: (path: string) => Promise<void>;
  refresh: () => Promise<void>;
  loadDrives: () => Promise<void>;
  loadRoots: () => Promise<void>;
  loadUserPaths: () => Promise<void>;
  
  // Selection
  toggleSelection: (path: string, isCtrl?: boolean, isShift?: boolean) => void;
  selectAll: () => void;
  clearSelection: () => void;
  setSearchFilter: (filter: string) => void;
  
  // View & Panes
  setViewMode: (mode: 'details' | 'grid' | 'list') => void;
  setSortBy: (field: string) => void;
  toggleDetailsPane: () => void;
  loadFileDetails: (path: string) => Promise<void>;
  
  // History
  goBack: () => void;
  goForward: () => void;
  goUp: () => void;
  
  // Clipboard
  copySelection: () => void;
  cutSelection: () => void;
  pasteClipboard: (destinationDir?: string) => Promise<void>;
  
  // Tabs
  addTab: (path?: string, title?: string, page?: NavigationPage) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
}

const initialTabId = 'tab-default';

export const useExplorerStore = create<ExplorerState>((set, get) => ({
  currentPath: '',
  entries: [],
  drives: [],
  roots: [],
  userPaths: {},
  selectedFiles: new Set(),
  focusedIndex: -1,
  viewMode: 'details',
  sortBy: 'name',
  sortOrder: 'asc',
  loading: false,
  error: null,
  history: [],
  historyIndex: -1,
  searchFilter: '',
  detailsPaneOpen: true,
  activeFileDetails: null,
  clipboard: null,
  tabs: [
    {
      id: initialTabId,
      title: 'This PC',
      path: '',
      history: [''],
      historyIndex: 0,
      icon: '🖥',
    },
  ],
  activeTabId: initialTabId,

  setPath: (path) => set({ currentPath: path }),

  navigateTo: async (path) => {
    set({ loading: true, error: null });
    try {
      if (!path) {
        // Navigating to "This PC" (drives view)
        const { history, historyIndex, activeTabId, tabs } = get();
        const newHistory = [...history.slice(0, historyIndex + 1), ''];
        const updatedTabs = tabs.map((t) =>
          t.id === activeTabId
            ? { ...t, path: '', title: 'This PC', history: newHistory, historyIndex: newHistory.length - 1 }
            : t
        );
        set({
          currentPath: '',
          entries: [],
          loading: false,
          selectedFiles: new Set(),
          focusedIndex: -1,
          activeFileDetails: null,
          history: newHistory,
          historyIndex: newHistory.length - 1,
          tabs: updatedTabs,
        });
        get().loadDrives();
        return;
      }

      const result = await api().fs.listDirectory(path, {
        sortBy: get().sortBy,
        sortOrder: get().sortOrder,
      });

      if (result.error) {
        set({ error: result.error, loading: false });
        return;
      }

      const { history, historyIndex, activeTabId, tabs } = get();
      const newHistory = [...history.slice(0, historyIndex + 1), path];
      const folderName = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;
      const updatedTabs = tabs.map((t) =>
        t.id === activeTabId
          ? { ...t, path, title: folderName, history: newHistory, historyIndex: newHistory.length - 1 }
          : t
      );

      set({
        currentPath: path,
        entries: result.entries,
        loading: false,
        selectedFiles: new Set(),
        focusedIndex: -1,
        activeFileDetails: null,
        history: newHistory,
        historyIndex: newHistory.length - 1,
        tabs: updatedTabs,
      });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to load directory', loading: false });
    }
  },

  refresh: async () => {
    const { currentPath, sortBy, sortOrder, roots } = get();
    if (!currentPath) {
      await get().loadDrives();
      return;
    }
    set({ loading: true });
    try {
      const result = await api().fs.listDirectory(currentPath, { sortBy, sortOrder });
      set({ entries: result.entries, loading: false });

      // If currentPath is inside or matches a registered root, trigger incremental scan
      const normalizedCurrent = currentPath.replace(/[\\/]+$/, '').toLowerCase();
      const matchedRoot = roots.find(r => {
        const rootNorm = r.path.replace(/[\\/]+$/, '').toLowerCase();
        return normalizedCurrent === rootNorm || normalizedCurrent.startsWith(rootNorm + '\\') || normalizedCurrent.startsWith(rootNorm + '/');
      });
      if (matchedRoot) {
        api().library.rescan(matchedRoot.path, false).catch(() => {});
      }
    } catch {
      set({ loading: false });
    }
  },

  loadDrives: async () => {
    try {
      const drives = await api().fs.listDrives();
      set({ drives });
    } catch (err) {
      console.error('Failed to load drives:', err);
    }
  },

  loadRoots: async () => {
    try {
      const roots = await api().roots.list();
      set({ roots });
    } catch (err) {
      console.warn('Failed to load registered roots:', err);
    }
  },

  loadUserPaths: async () => {
    try {
      const paths = await api().app.getPaths();
      if (paths) {
        set({ userPaths: paths as any });
      }
    } catch (err) {
      console.warn('Failed to load user paths:', err);
    }
  },

  toggleSelection: (targetPath, isCtrl, isShift) => {
    const { entries, selectedFiles, currentPath } = get();
    const targetIdx = entries.findIndex((e) => e.path === targetPath);

    if (isShift && get().focusedIndex >= 0 && targetIdx >= 0) {
      const start = Math.min(get().focusedIndex, targetIdx);
      const end = Math.max(get().focusedIndex, targetIdx);
      const newSelected = new Set(isCtrl ? selectedFiles : []);
      for (let i = start; i <= end; i++) {
        newSelected.add(entries[i].path);
      }
      set({ selectedFiles: newSelected });
      return;
    }

    if (isCtrl) {
      const newSelected = new Set(selectedFiles);
      if (newSelected.has(targetPath)) {
        newSelected.delete(targetPath);
      } else {
        newSelected.add(targetPath);
      }
      set({ selectedFiles: newSelected, focusedIndex: targetIdx });
      if (newSelected.size === 1) {
        get().loadFileDetails(targetPath);
      } else {
        set({ activeFileDetails: null });
      }
      return;
    }

    // Single item selection
    set({ selectedFiles: new Set([targetPath]), focusedIndex: targetIdx });
    get().loadFileDetails(targetPath);
  },

  selectAll: () => {
    const { entries } = get();
    const allPaths = new Set(entries.map((e) => e.path));
    set({ selectedFiles: allPaths });
  },

  clearSelection: () => set({ selectedFiles: new Set(), focusedIndex: -1, activeFileDetails: null }),

  setSearchFilter: (filter) => set({ searchFilter: filter }),

  setViewMode: (mode) => set({ viewMode: mode }),

  setSortBy: (field) => {
    const currentSort = get().sortBy;
    const currentOrder = get().sortOrder;
    if (currentSort === field) {
      set({ sortOrder: currentOrder === 'asc' ? 'desc' : 'asc' });
    } else {
      set({ sortBy: field, sortOrder: 'asc' });
    }
    const path = get().currentPath;
    if (path) get().navigateTo(path);
  },

  toggleDetailsPane: () => set((s) => ({ detailsPaneOpen: !s.detailsPaneOpen })),

  loadFileDetails: async (filePath) => {
    try {
      const details = await api().fs.getFileInfo(filePath);
      if (details) {
        set({ activeFileDetails: details as DetailedEntry });
      }
    } catch (err) {
      console.warn('Failed to fetch file details:', err);
    }
  },

  goBack: () => {
    const { history, historyIndex, activeTabId, tabs } = get();
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      const targetPath = history[newIndex];
      const folderName = targetPath ? targetPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || targetPath : 'This PC';
      const updatedTabs = tabs.map((t) =>
        t.id === activeTabId
          ? { ...t, path: targetPath, title: folderName, historyIndex: newIndex }
          : t
      );
      set({ historyIndex: newIndex, currentPath: targetPath, tabs: updatedTabs });
      if (targetPath) {
        get().navigateTo(targetPath);
      } else {
        set({ currentPath: '', entries: [], selectedFiles: new Set(), activeFileDetails: null });
        get().loadDrives();
      }
    }
  },

  goForward: () => {
    const { history, historyIndex, activeTabId, tabs } = get();
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      const targetPath = history[newIndex];
      const folderName = targetPath ? targetPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || targetPath : 'This PC';
      const updatedTabs = tabs.map((t) =>
        t.id === activeTabId
          ? { ...t, path: targetPath, title: folderName, historyIndex: newIndex }
          : t
      );
      set({ historyIndex: newIndex, currentPath: targetPath, tabs: updatedTabs });
      if (targetPath) {
        get().navigateTo(targetPath);
      } else {
        set({ currentPath: '', entries: [], selectedFiles: new Set(), activeFileDetails: null });
        get().loadDrives();
      }
    }
  },

  goUp: () => {
    const { currentPath } = get();
    if (!currentPath) return;
    const clean = currentPath.replace(/[\\/]+$/, '');
    const parent = clean.replace(/[\\/][^\\/]+$/, '');
    if (parent && parent !== clean) {
      get().navigateTo(parent.endsWith(':') ? parent + '\\' : parent);
    } else {
      get().navigateTo('');
    }
  },

  copySelection: () => {
    const { selectedFiles } = get();
    if (selectedFiles.size > 0) {
      set({ clipboard: { items: Array.from(selectedFiles), action: 'copy' } });
      toast.info(`Copied ${selectedFiles.size} item${selectedFiles.size > 1 ? 's' : ''} to clipboard`);
    }
  },

  cutSelection: () => {
    const { selectedFiles } = get();
    if (selectedFiles.size > 0) {
      set({ clipboard: { items: Array.from(selectedFiles), action: 'cut' } });
      toast.info(`Cut ${selectedFiles.size} item${selectedFiles.size > 1 ? 's' : ''} to clipboard`);
    }
  },

  pasteClipboard: async (destinationDir) => {
    const { clipboard, currentPath } = get();
    const dest = destinationDir || currentPath;
    if (!clipboard || clipboard.items.length === 0 || !dest) {
      toast.warning('Nothing to paste or no destination folder specified');
      return;
    }

    try {
      const copyItems = clipboard.items.map((src) => {
        const name = src.split(/[\\/]/).pop() || 'file';
        return {
          sourcePath: src,
          destinationPath: `${dest.replace(/[\\/]+$/, '')}\\${name}`,
        };
      });

      const res = await api().operations.copy('Clipboard Paste', dest, copyItems);
      if (res.success) {
        toast.success(`Pasted ${res.completedFiles} item${res.completedFiles > 1 ? 's' : ''} successfully`);
        if (clipboard.action === 'cut') {
          // If cut, recycle source files safely
          for (const item of copyItems) {
            try {
              await api().fs.trashItem(item.sourcePath);
            } catch {}
          }
          set({ clipboard: null });
        }
        await get().refresh();
      } else {
        toast.error(`Paste failed: ${res.errors.join(', ')}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err), 'Paste failed');
    }
  },

  addTab: (path = '', title = 'This PC', page) => {
    const newId = `tab-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const newTab: ExplorerTab = {
      id: newId,
      title: title || (path ? path.split(/[\\/]/).pop() || path : 'This PC'),
      path,
      page,
      icon: page ? '⚡' : path ? '📁' : '🖥',
      history: [path],
      historyIndex: 0,
    };
    set((state) => ({
      tabs: [...state.tabs, newTab],
      activeTabId: newId,
    }));
    if (page) {
      useNavigationStore.getState().setPage(page);
    } else {
      useNavigationStore.getState().setPage('explorer');
      get().navigateTo(path);
    }
  },

  closeTab: (tabId) => {
    const { tabs, activeTabId } = get();
    if (tabs.length <= 1) return; // Keep at least one tab open
    const closeIdx = tabs.findIndex((t) => t.id === tabId);
    const newTabs = tabs.filter((t) => t.id !== tabId);
    let nextActiveId = activeTabId;
    if (activeTabId === tabId) {
      const nextIdx = Math.max(0, closeIdx - 1);
      nextActiveId = newTabs[nextIdx].id;
    }
    set({ tabs: newTabs, activeTabId: nextActiveId });
    const targetTab = newTabs.find((t) => t.id === nextActiveId);
    if (targetTab) {
      if (targetTab.page) {
        useNavigationStore.getState().setPage(targetTab.page);
      } else {
        useNavigationStore.getState().setPage('explorer');
        set({ currentPath: targetTab.path, history: targetTab.history, historyIndex: targetTab.historyIndex });
        if (targetTab.path) get().navigateTo(targetTab.path);
        else get().loadDrives();
      }
    }
  },

  setActiveTab: (tabId) => {
    const { tabs } = get();
    const targetTab = tabs.find((t) => t.id === tabId);
    if (!targetTab) return;
    set({ activeTabId: tabId });
    if (targetTab.page) {
      useNavigationStore.getState().setPage(targetTab.page);
    } else {
      useNavigationStore.getState().setPage('explorer');
      set({ currentPath: targetTab.path, history: targetTab.history, historyIndex: targetTab.historyIndex });
      if (targetTab.path) {
        get().navigateTo(targetTab.path);
      } else {
        set({ currentPath: '', entries: [], selectedFiles: new Set(), activeFileDetails: null });
        get().loadDrives();
      }
    }
  },
}));

// ─── Jobs Store ──────────────────────────────────────────────────────────────

interface JobsState {
  jobs: Job[];
  queueStats: JobQueueStats | null;
  loading: boolean;
  fetchJobs: (status?: string) => Promise<void>;
  fetchQueueStats: () => Promise<void>;
  cancelJob: (id: string) => Promise<void>;
  pauseJob: (id: string) => Promise<void>;
  resumeJob: (id: string) => Promise<void>;
  retryJob: (id: string) => Promise<void>;
  clearCompletedJobs: () => Promise<void>;
  initListeners: () => () => void;
}

export const useJobsStore = create<JobsState>((set, get) => ({
  jobs: [],
  queueStats: null,
  loading: false,
  fetchJobs: async (status?) => {
    set({ loading: true });
    try {
      const jobs = await api().jobs.list(status);
      set({ jobs, loading: false });
    } catch {
      set({ loading: false });
    }
  },
  fetchQueueStats: async () => {
    try {
      const stats = await api().system.getQueueStats();
      set({ queueStats: stats });
    } catch {}
  },
  cancelJob: async (id) => {
    await api().jobs.cancel(id);
    get().fetchJobs();
    get().fetchQueueStats();
  },
  pauseJob: async (id) => {
    await api().jobs.pause(id);
    get().fetchJobs();
    get().fetchQueueStats();
  },
  resumeJob: async (id) => {
    await api().jobs.resume(id);
    get().fetchJobs();
    get().fetchQueueStats();
  },
  retryJob: async (id) => {
    await api().jobs.retry(id);
    get().fetchJobs();
    get().fetchQueueStats();
  },
  clearCompletedJobs: async () => {
    await api().jobs.clearCompleted();
    get().fetchJobs();
    get().fetchQueueStats();
  },
  initListeners: () => {
    const handleProgress = (data: any) => {
      set((state) => {
        const nextJobs = state.jobs.map((j) => {
          if (j.id === data.jobId) {
            return {
              ...j,
              status: data.status || j.status,
              progress: data.progress !== undefined ? data.progress : j.progress,
              total: data.total !== undefined ? data.total : j.total,
            };
          }
          return j;
        });
        return { jobs: nextJobs };
      });
    };

    const handleCompleted = (data: any) => {
      set((state) => {
        const nextJobs = state.jobs.map((j) => {
          if (j.id === data.jobId) {
            return { ...j, status: 'completed' as const, progress: j.total, completed_at: new Date().toISOString() };
          }
          return j;
        });
        return { jobs: nextJobs };
      });
      get().fetchQueueStats();
    };

    const handleCancelled = (data: any) => {
      set((state) => {
        const nextJobs = state.jobs.map((j) => {
          if (j.id === data.jobId) {
            return { ...j, status: 'cancelled' as const };
          }
          return j;
        });
        return { jobs: nextJobs };
      });
      get().fetchQueueStats();
    };

    const handleError = (data: any) => {
      set((state) => {
        const nextJobs = state.jobs.map((j) => {
          if (j.id === data.jobId) {
            return { ...j, status: 'failed' as const, error_message: data.error };
          }
          return j;
        });
        return { jobs: nextJobs };
      });
      get().fetchQueueStats();
    };

    const handleQueueChanged = (stats: any) => {
      if (stats) {
        set({ queueStats: stats });
      }
    };

    api().on('job:progress', handleProgress);
    api().on('job:completed', handleCompleted);
    api().on('job:cancelled', handleCancelled);
    api().on('job:error', handleError);
    api().on('queue:status-changed', handleQueueChanged);

    return () => {
      api().removeAllListeners('job:progress');
      api().removeAllListeners('job:completed');
      api().removeAllListeners('job:cancelled');
      api().removeAllListeners('job:error');
      api().removeAllListeners('queue:status-changed');
    };
  },
}));

// ─── People Store ────────────────────────────────────────────────────────────

interface PeopleState {
  people: Person[];
  loading: boolean;
  selectedPersonId: string | null;
  fetchPeople: () => Promise<void>;
  selectPerson: (id: string | null) => void;
  updatePerson: (id: string, updates: Record<string, unknown>) => Promise<void>;
  deletePerson: (id: string) => Promise<void>;
}

export const usePeopleStore = create<PeopleState>((set, get) => ({
  people: [],
  loading: false,
  selectedPersonId: null,
  fetchPeople: async () => {
    set({ loading: true });
    try {
      const people = await api().people.list();
      set({ people, loading: false });
    } catch {
      set({ loading: false });
    }
  },
  selectPerson: (id) => set({ selectedPersonId: id }),
  updatePerson: async (id, updates) => {
    await api().people.update(id, updates);
    get().fetchPeople();
  },
  deletePerson: async (id) => {
    await api().people.delete(id);
    get().fetchPeople();
  },
}));

// ─── Watcher Store ───────────────────────────────────────────────────────────

interface WatcherState {
  watchRoots: WatchRoot[];
  loading: boolean;
  fetchWatchRoots: () => Promise<void>;
  addWatchRoot: (path: string, label: string) => Promise<void>;
  removeWatchRoot: (id: string) => Promise<void>;
  toggleWatchRoot: (id: string, active: boolean) => Promise<void>;
}

export const useWatcherStore = create<WatcherState>((set, get) => ({
  watchRoots: [],
  loading: false,
  fetchWatchRoots: async () => {
    set({ loading: true });
    try {
      const watchRoots = await api().watcher.list();
      set({ watchRoots, loading: false });
    } catch {
      set({ loading: false });
    }
  },
  addWatchRoot: async (path, label) => {
    await api().watcher.add(path, label);
    get().fetchWatchRoots();
  },
  removeWatchRoot: async (id) => {
    await api().watcher.remove(id);
    get().fetchWatchRoots();
  },
  toggleWatchRoot: async (id, active) => {
    await api().watcher.toggle(id, active);
    get().fetchWatchRoots();
  },
}));

// ─── Toast / In-App Notification Store ──────────────────────────────────────

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastMessage {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  duration?: number;
}

interface ToastState {
  toasts: ToastMessage[];
  addToast: (toast: Omit<ToastMessage, 'id'>) => string;
  removeToast: (id: string) => void;
  clearToasts: () => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  addToast: (t) => {
    const id = Math.random().toString(36).substring(2, 9);
    const duration = t.duration ?? (t.type === 'error' ? 6000 : 4000);
    const newToast: ToastMessage = { ...t, id, duration };
    set((state) => ({ toasts: [...state.toasts, newToast] }));
    if (duration > 0) {
      setTimeout(() => {
        set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) }));
      }, duration);
    }
    return id;
  },
  removeToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  clearToasts: () => set({ toasts: [] }),
}));

export const toast = {
  success: (message: string, title?: string) => useToastStore.getState().addToast({ type: 'success', message, title }),
  error: (message: string, title?: string) => useToastStore.getState().addToast({ type: 'error', message, title }),
  info: (message: string, title?: string) => useToastStore.getState().addToast({ type: 'info', message, title }),
  warning: (message: string, title?: string) => useToastStore.getState().addToast({ type: 'warning', message, title }),
};

