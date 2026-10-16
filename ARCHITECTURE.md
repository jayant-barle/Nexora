# System Architecture Documentation

## Product: Nexora — AI File Manager
**Tagline:** *"Your files. Your intelligence. Your control."*  
**Version:** 1.0.0  
**Status:** Approved & Implemented  
**Platform:** Windows 11 (x64) desktop  
**Visual Identity:** Cinematic, futuristic, minimal black/charcoal surfaces (`#0a0a0a`), neon-lime accents (`#b4ff32`), glassmorphism  

---

## 1. High-Level System Architecture

**Nexora** adopts a decoupled, multi-process desktop architecture designed for maximum security, local data privacy, and non-blocking asynchronous processing:

```mermaid
graph TB
    subgraph "Renderer Process (Chromium)"
        UI[React 18 UI Shell]
        Stores[Zustand State Stores]
        APIBridge[Renderer API Bridge: services/api.ts]
        UI --> Stores
        Stores --> APIBridge
    end

    subgraph "Preload Layer (Isolated Context)"
        ContextBridge[contextBridge.exposeInMainWorld]
        PreloadAPI[electronAPI: preload/index.ts]
        APIBridge --> PreloadAPI
        PreloadAPI --> ContextBridge
    end

    subgraph "Main Process (Node.js)"
        IPC[IPC Handlers: ipc-handlers.ts]
        WinManager[Window Manager: index.ts]
        FSService[Filesystem Service: filesystem.ts]
        DBService[SQLite Database: database.ts]
        JobQueue[Background Job Queue & Watcher]
        
        ContextBridge -->|IPC invoke / handle| IPC
        IPC --> FSService
        IPC --> DBService
        IPC --> JobQueue
        WinManager --> IPC
    end

    subgraph "Embedded Database"
        SQLite[(better-sqlite3 WAL Mode)]
        FTS5[(FTS5 Full-Text Index)]
        DBService --> SQLite
        DBService --> FTS5
    end

    subgraph "AI Worker Subprocess (Python 3)"
        JSONRPC[JSON-RPC Engine: stdin/stdout]
        HashEngine[SHA-256 & Perceptual dHash]
        EXIFParser[EXIF, GPS & Metadata Parser]
        FaceEngine[Face Detection & Cosine Clustering]
        ThumbnailGen[Pillow JPEG Downscaler]
        
        JobQueue -->|spawn / JSON Lines| JSONRPC
        JSONRPC --> HashEngine
        JSONRPC --> EXIFParser
        JSONRPC --> FaceEngine
        JSONRPC --> ThumbnailGen
    end
```

---

## 2. Process Model & Separation of Concerns

### 2.1 The Renderer Process (`src/renderer/`)
- **Technology**: React 18, Vite 6, TypeScript 5.7+, Vanilla CSS.
- **Responsibilities**:
  - Render all 12 views ([DashboardPage](file:///e:/Code%20Tresure/File%20manager/src/renderer/pages/DashboardPage.tsx), [ExplorerPage](file:///e:/Code%20Tresure/File%20manager/src/renderer/pages/ExplorerPage.tsx), [PeoplePage](file:///e:/Code%20Tresure/File%20manager/src/renderer/pages/PeoplePage.tsx), [SearchPage](file:///e:/Code%20Tresure/File%20manager/src/renderer/pages/SearchPage.tsx), [TimelinePage](file:///e:/Code%20Tresure/File%20manager/src/renderer/pages/TimelinePage.tsx), [EventsPage](file:///e:/Code%20Tresure/File%20manager/src/renderer/pages/EventsPage.tsx), [DuplicatesPage](file:///e:/Code%20Tresure/File%20manager/src/renderer/pages/DuplicatesPage.tsx), [StoragePage](file:///e:/Code%20Tresure/File%20manager/src/renderer/pages/StoragePage.tsx), [ActivityPage](file:///e:/Code%20Tresure/File%20manager/src/renderer/pages/ActivityPage.tsx), [HistoryPage](file:///e:/Code%20Tresure/File%20manager/src/renderer/pages/HistoryPage.tsx), [WatchedFoldersPage](file:///e:/Code%20Tresure/File%20manager/src/renderer/pages/WatchedFoldersPage.tsx), [SettingsPage](file:///e:/Code%20Tresure/File%20manager/src/renderer/pages/SettingsPage.tsx)).
  - Manage state via scoped Zustand stores (`useNavigationStore`, `useExplorerStore`, `useDashboardStore`, `useJobsStore`, `usePeopleStore`, `useWatcherStore`).
  - Render modal overlays, progress bars, and reactive toast notifications.
- **Security Constraint**: Zero access to Node.js `require`, `fs`, `child_process`, or direct OS APIs.

### 2.2 The Preload Bridge (`src/preload/`)
- **Technology**: Electron `contextBridge`, `ipcRenderer`.
- **Responsibilities**:
  - Expose a strictly typed `window.electronAPI` interface to the renderer.
  - Mediate request/response cycles and filter incoming event channels (`job:progress`, `job:completed`, `job:error`, `watcher:change`).
- **Security Constraint**: Runs in an isolated execution context (`contextIsolation: true`). Does not leak Electron internal references.

### 2.3 The Main Process (`src/main/`)
- **Technology**: Node.js, Electron, `better-sqlite3`, `chokidar`.
- **Responsibilities**:
  - App lifecycle, window creation, menu management, and security lockdowns (`will-navigate`, `setWindowOpenHandler`).
  - Handle all IPC commands, validating and sanitizing paths, IDs, and payload parameters.
  - Execute native Windows drive queries via `wmic logicaldisk` and filesystem traversals.
  - Maintain the SQLite database in Write-Ahead Logging (`WAL`) mode with versioned migrations.
  - Supervise background task queues and dispatch jobs.

### 2.4 The Python AI Worker (`ai-worker/`)
- **Technology**: Python 3.10+, Standard Library, Pillow, NumPy, SciPy (optional).
- **Responsibilities**:
  - Long-running computational inference: SHA-256 and perceptual difference hashing (`dHash`).
  - EXIF header parsing, GPS latitude/longitude extraction, camera model detection.
  - Face detection bounding box normalization, feature embedding, and pairwise cosine distance clustering.
  - Thumbnail resizing and JPEG compression.
- **Protocol**: Standard I/O (stdin/stdout) line-delimited JSON-RPC messages.

---

## 3. Core Sequence Flows

### 3.1 Folder Indexing & Background Processing Flow

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Renderer as React UI (App.tsx)
    participant Preload as Preload Bridge
    participant Main as Electron Main (ipc-handlers.ts)
    participant DB as SQLite (database.ts)
    participant Worker as Python AI Worker

    User->>Renderer: Clicks "Index Folder" & Selects Path
    Renderer->>Preload: electronAPI.jobs.create('folder_scan', folderPath)
    Preload->>Main: ipcMain.handle('jobs:create')
    Main->>DB: INSERT INTO jobs (status='queued', type='folder_scan')
    Main-->>Renderer: Return Job Record
    Renderer->>User: Display Active Jobs Badge

    Note over Main,Worker: Asynchronous Queue Execution
    Main->>DB: UPDATE jobs SET status='running'
    Main->>Main: Traverse directory & collect media files
    loop For Each Media File
        Main->>Worker: {"action": "extract_metadata", "params": {"file_path": ...}}
        Worker-->>Main: {"status": "ok", "result": {...EXIF, dimensions, GPS...}}
        Main->>Worker: {"action": "compute_hashes", "params": {"file_path": ...}}
        Worker-->>Main: {"status": "ok", "result": {"sha256": "...", "phash": "..."}}
        Main->>DB: INSERT OR REPLACE INTO files (...)
        Main->>DB: INSERT INTO search_index (fts5)
        Main->>Renderer: emit('job:progress', {jobId, progress, total})
    end
    Main->>DB: UPDATE jobs SET status='completed'
    Main->>Renderer: emit('job:completed', {jobId})
```

---

## 4. State Management Architecture

State is managed via modular [Zustand](https://github.com/pmndrs/zustand) stores located in `src/renderer/store/index.ts`:

| Store | State Variables | Primary Actions |
| :--- | :--- | :--- |
| `useNavigationStore` | `currentPage`, `sidebarCollapsed` | `setPage(page)`, `toggleSidebar()` |
| `useExplorerStore` | `currentPath`, `entries`, `drives`, `selectedFiles`, `viewMode`, `sortBy`, `sortOrder`, `history` | `navigateTo(path)`, `loadDrives()`, `toggleSelection()`, `goBack()`, `goForward()`, `goUp()` |
| `useDashboardStore` | `stats`, `loading`, `error` | `fetchStats()` |
| `usePeopleStore` | `people`, `loading`, `selectedPersonId` | `fetchPeople()`, `selectPerson()`, `updatePerson()`, `deletePerson()` |
| `useJobsStore` | `jobs`, `loading` | `fetchJobs()`, `cancelJob()`, `pauseJob()`, `resumeJob()` |
| `useWatcherStore` | `watchRoots`, `loading` | `fetchWatchRoots()`, `addWatchRoot()`, `removeWatchRoot()`, `toggleWatchRoot()` |

---

## 5. Security & Isolation Controls

1. **Context Isolation**: `webPreferences.contextIsolation = true` ensures the renderer cannot modify or tamper with preload prototypes.
2. **Node Integration Disabled**: `webPreferences.nodeIntegration = false` prevents the execution of arbitrary Node.js scripts in the Chromium DOM.
3. **No External Script Ingestion**: Content Security Policy (`CSP`) defined in `src/renderer/index.html` restricts scripts to `'self'` and blocks remote executable code.
4. **Navigation Interception**:
   - `contents.setWindowOpenHandler(() => ({ action: 'deny' }))` denies unauthorized popup windows.
   - `contents.on('will-navigate', ...)` blocks top-level navigation to external web destinations.
5. **Path Traversal & Injection Defense**:
   - `validatePath()` normalizes incoming Windows paths and rejects null bytes (`\0`).
   - `validateId()` verifies UUID or alphanumeric formats to prevent SQL injection in dynamic statements.

---

## 6. Architecture Decision Records (ADRs)

### ADR-01: SQLite (`better-sqlite3`) as the Primary Data Store
- **Context**: The app must index hundreds of thousands of files with complex relationships (faces, clusters, GPS, tags) without cloud dependencies.
- **Decision**: Adopt SQLite via the synchronous, high-throughput `better-sqlite3` driver with Write-Ahead Logging (`WAL`).
- **Consequences**: Instant query execution, zero external daemon processes, full ACID compliance, and built-in FTS5 full-text search. Requires Electron native module compilation during install.

### ADR-02: Decoupled Python Subprocess for AI Inference
- **Context**: Face detection, clustering, and perceptual image hashing require numerical algorithms often best supported in Python.
- **Decision**: Isolate AI inference into a dedicated Python worker running over standard I/O (JSON-RPC) rather than binding heavyweight C++ libraries into the Electron main process.
- **Consequences**: If the AI model crashes on a corrupt image, the main application remains stable. Includes pure-Python fallbacks to run on minimal Python installations.

### ADR-03: Copy-First Non-Destructive File Organization
- **Context**: Automated photo organization tools risk accidental data loss if move or overwrite operations fail.
- **Decision**: All organization workflows use copy-first operations with mandatory SHA-256 source/destination hash verifications and maintain a reversible transaction history in `operation_history`.
- **Consequences**: User data is protected against corruption, partial transfers, or disk disconnections.

---

## 10. Specialized Engineering Specifications

For in-depth domain specifications, consult the dedicated architecture documents:

- [FILE_OPERATIONS.md](file:///e:/Code%20Tresure/File%20manager/FILE_OPERATIONS.md) — Copy-first preservation, verification, and rollback mechanics.
- [AI_PIPELINE.md](file:///e:/Code%20Tresure/File%20manager/AI_PIPELINE.md) — Subprocess JSON-RPC worker, hashing, EXIF, and facial recognition.
- [PRIVACY_SECURITY.md](file:///e:/Code%20Tresure/File%20manager/PRIVACY_SECURITY.md) — Zero-cloud architecture, biometric data isolation, and Electron hardening.
- [SEARCH_DUPLICATES.md](file:///e:/Code%20Tresure/File%20manager/SEARCH_DUPLICATES.md) — SQLite FTS5 search indexing and exact/perceptual deduplication engine.
- [WATCH_FOLDERS.md](file:///e:/Code%20Tresure/File%20manager/WATCH_FOLDERS.md) — Chokidar directory monitoring, debounce windows, and offline re-sync.
- [ERROR_HANDLING.md](file:///e:/Code%20Tresure/File%20manager/ERROR_HANDLING.md) — Multi-tier error boundaries, database transactions, and crash recovery.
- [PERFORMANCE.md](file:///e:/Code%20Tresure/File%20manager/PERFORMANCE.md) — Large-library scalability targets, WAL tuning, and 60 FPS rendering.
- [DEPENDENCIES.md](file:///e:/Code%20Tresure/File%20manager/DEPENDENCIES.md) — Production and development dependency inventory, licenses, and ABI guide.
- [DATABASE_SCHEMA.md](file:///e:/Code%20Tresure/File%20manager/DATABASE_SCHEMA.md) — SQLite 3 schema documentation for all 25 tables and FTS5 indices.
- [UI_UX_SPEC.md](file:///e:/Code%20Tresure/File%20manager/UI_UX_SPEC.md) — Design tokens, visual identity, and specifications for all 12 views.
