// ============================================================================
// Nexora — Global Store (Zustand)
// ============================================================================

import { create } from 'zustand';
import type { NavigationPage, DashboardStats, DirectoryEntry, DriveInfo, Job, Person, WatchRoot } from '../../shared/types';
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

interface ExplorerState {
  currentPath: string;
  entries: DirectoryEntry[];
  drives: DriveInfo[];
  selectedFiles: Set<string>;
  viewMode: 'grid' | 'list';
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  loading: boolean;
  error: string | null;
  history: string[];
  historyIndex: number;
  setPath: (path: string) => void;
  navigateTo: (path: string) => Promise<void>;
  loadDrives: () => Promise<void>;
  toggleSelection: (path: string) => void;
  clearSelection: () => void;
  setViewMode: (mode: 'grid' | 'list') => void;
  setSortBy: (field: string) => void;
  goBack: () => void;
  goForward: () => void;
  goUp: () => void;
}

export const useExplorerStore = create<ExplorerState>((set, get) => ({
  currentPath: '',
  entries: [],
  drives: [],
  selectedFiles: new Set(),
  viewMode: 'grid',
  sortBy: 'name',
  sortOrder: 'asc',
  loading: false,
  error: null,
  history: [],
  historyIndex: -1,

  setPath: (path) => set({ currentPath: path }),

  navigateTo: async (path) => {
    set({ loading: true, error: null });
    try {
      const result = await api().fs.listDirectory(path, {
        sortBy: get().sortBy,
        sortOrder: get().sortOrder,
      });
      if (result.error) {
        set({ error: result.error, loading: false });
        return;
      }
      const { history, historyIndex } = get();
      const newHistory = [...history.slice(0, historyIndex + 1), path];
      set({
        currentPath: path,
        entries: result.entries,
        loading: false,
        selectedFiles: new Set(),
        history: newHistory,
        historyIndex: newHistory.length - 1,
      });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to load directory', loading: false });
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

  toggleSelection: (path) => {
    const selected = new Set(get().selectedFiles);
    if (selected.has(path)) {
      selected.delete(path);
    } else {
      selected.add(path);
    }
    set({ selectedFiles: selected });
  },

  clearSelection: () => set({ selectedFiles: new Set() }),

  setViewMode: (mode) => set({ viewMode: mode }),

  setSortBy: (field) => {
    const currentSort = get().sortBy;
    const currentOrder = get().sortOrder;
    if (currentSort === field) {
      set({ sortOrder: currentOrder === 'asc' ? 'desc' : 'asc' });
    } else {
      set({ sortBy: field, sortOrder: 'asc' });
    }
    // Re-fetch with new sort
    const path = get().currentPath;
    if (path) get().navigateTo(path);
  },

  goBack: () => {
    const { history, historyIndex } = get();
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      const path = history[newIndex];
      set({ historyIndex: newIndex });
      get().navigateTo(path);
    }
  },

  goForward: () => {
    const { history, historyIndex } = get();
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      const path = history[newIndex];
      set({ historyIndex: newIndex });
      get().navigateTo(path);
    }
  },

  goUp: () => {
    const { currentPath } = get();
    if (!currentPath) return;
    const parent = currentPath.replace(/[\\/][^\\/]+[\\/]?$/, '');
    if (parent && parent !== currentPath) {
      get().navigateTo(parent.endsWith('\\') ? parent : parent + '\\');
    }
  },
}));

// ─── Jobs Store ──────────────────────────────────────────────────────────────

interface JobsState {
  jobs: Job[];
  loading: boolean;
  fetchJobs: (status?: string) => Promise<void>;
  cancelJob: (id: string) => Promise<void>;
  pauseJob: (id: string) => Promise<void>;
  resumeJob: (id: string) => Promise<void>;
}

export const useJobsStore = create<JobsState>((set, get) => ({
  jobs: [],
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
  cancelJob: async (id) => {
    await api().jobs.cancel(id);
    get().fetchJobs();
  },
  pauseJob: async (id) => {
    await api().jobs.pause(id);
    get().fetchJobs();
  },
  resumeJob: async (id) => {
    await api().jobs.resume(id);
    get().fetchJobs();
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

