# AI File Manager — Architecture & Operational Documentation

## Overview
**AI File Manager** is a high-performance, local-first Windows 11 desktop application that unites traditional Windows file system operations with automated on-device AI intelligence:
- **Facial Recognition & Clustering**: Group photos and videos by detected faces with review/confirmation workflows.
- **Smart Natural & Metadata Search**: Full-text indexing, EXIF dates, dimensions, GPS locations, and tags.
- **Deduplication & Safety**: Exact SHA-256 hash deduplication, perceptual difference hashing, and non-destructive operations.
- **Continuous Monitoring**: Windows filesystem change watchers for automatic background indexing.

---

## Architecture Diagram

```
+-------------------------------------------------------------------------+
|                          Electron Desktop App                           |
|                                                                         |
|  +-------------------------------------------------------------------+  |
|  |                     React 18 Renderer UI                          |  |
|  |  * Modern Windows 11 Dark Charcoal & Neon-Lime Design             |  |
|  |  * Zustand Store (Explorer, People, Search, Jobs, Watchers)       |  |
|  |  * 12 Dedicated Views (Dashboard, Explorer, People, Duplicates...) |  |
|  +---------------------------------+---------------------------------+  |
|                                    | contextBridge (Safe API)           |
|  +---------------------------------v---------------------------------+  |
|  |                     Electron Main Process                         |  |
|  |  * Node.js runtime with contextIsolation & CSP                   |  |
|  |  * Native Windows Drive & Filesystem APIs                         |  |
|  |  * SQLite DB (WAL mode, FTS5, versioned migrations)              |  |
|  |  * Background Task Manager & Job Queue                            |  |
|  +---------------------------------+---------------------------------+  |
|                                    | JSON-RPC (stdin / stdout)          |
|  +---------------------------------v---------------------------------+  |
|  |                     Python AI Worker                              |  |
|  |  * SHA-256 & Perceptual Hashing (dHash)                           |  |
|  |  * EXIF & GPS Metadata Extraction                                 |  |
|  |  * Face Detection, Feature Embedding & Cosine Clustering         |  |
|  |  * Graceful fallbacks for standard library & pure Python          |  |
+--+-------------------------------------------------------------------+--+
```

---

## Project Structure

```
├── ai-worker/
│   ├── requirements.txt         # Python AI dependencies
│   └── src/
│       └── main.py              # Subprocess JSON-RPC AI inference engine
├── database/
│   └── migrations/
│       └── 001_initial.sql      # SQLite schema v1 (roots, files, people, jobs, etc.)
├── scripts/
│   └── migrate.js               # Standalone DB migration runner
├── src/
│   ├── main/
│   │   ├── database.ts          # SQLite connection, queries, and migrations
│   │   ├── filesystem.ts        # Drive scanning, Windows directory listing
│   │   ├── index.ts             # Electron main process entry & window creation
│   │   └── ipc-handlers.ts      # Type-safe IPC channels with validation
│   ├── preload/
│   │   └── index.ts             # contextBridge secure API expose
│   ├── renderer/
│   │   ├── components/          # Sidebar, layout components
│   │   ├── pages/               # 12 views (Dashboard, Explorer, People, Search...)
│   │   ├── services/api.ts      # Renderer Electron API bridge with browser mock
│   │   ├── store/index.ts       # Global Zustand state management
│   │   ├── styles/              # Design tokens and global CSS
│   │   ├── App.tsx              # App shell with topbar & modals
│   │   ├── index.html           # Vite root HTML
│   │   └── main.tsx             # React 18 createRoot
│   └── shared/
│       └── types.ts             # Unified TypeScript data models & contracts
├── tests/
│   └── unit/                    # Vitest unit test suites
└── vite.config.ts               # Vite configuration for renderer
```

---

## Completed Views & Features

1. **Dashboard (`DashboardPage.tsx`)**: Real-time KPI counters (indexed files, images, videos, detected people, active jobs, storage used) and quick shortcuts.
2. **File Explorer (`ExplorerPage.tsx`)**: Windows drive selector, breadcrumb trail, forward/backward/up navigation, grid/list toggle, file selection, and opening items in Windows File Explorer.
3. **People (`PeoplePage.tsx`)**: Face cluster grouping, renaming, review status filters (Unreviewed, Reviewed, Confirmed), hiding/excluding, and cluster merging.
4. **Smart Search (`SearchPage.tsx`)**: High-speed database search filtered by text, extension, date ranges, and file size with timing telemetry.
5. **Timeline (`TimelinePage.tsx`)**: Chronological grouping by Year, Month, or Day extracted from EXIF capture timestamps.
6. **Events & Places (`EventsPage.tsx`)**: Grouping media by detected events and GPS coordinates.
7. **Duplicates (`DuplicatesPage.tsx`)**: Side-by-side duplicate comparison, exact SHA-256 vs perceptual similarity filters, and resolution actions (Keep Best, Move to Trash, Hardlink).
8. **Storage Analytics (`StoragePage.tsx`)**: Physical drive capacity meters, space allocation breakdown, and heaviest file locator.
9. **Activity & Jobs (`ActivityPage.tsx`)**: Real-time worker thread monitor with pause, resume, cancel controls and error stack logs.
10. **Operations History (`HistoryPage.tsx`)**: Audit log of file reorganization operations with one-click rollback.
11. **Watched Folders (`WatchedFoldersPage.tsx`)**: Windows directory watcher management with native folder dialog and auto-indexing toggles.
12. **Settings (`SettingsPage.tsx`)**: Model confidence threshold sliders, library folder path selection, SHA-256 verification toggles, and system diagnostics.

---

## Verification & Commands

- **Unit Tests**: `npm test` (Runs Vitest suite)
- **Type Checking**: `npm run typecheck` and `npm run typecheck:main`
- **Build Full Application**: `npm run build`
- **Run Electron Desktop Dev**: `npm run dev`
