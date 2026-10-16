# Changelog

All notable changes to the **AI File Manager** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.0] - 2026-10-16

### Added
- **Electron Desktop Shell**:
  - Secure multi-process desktop foundation with `contextIsolation: true` and `nodeIntegration: false`.
  - Native window controls, custom background color, and production menu suppression.
  - Strict Content Security Policy (`CSP`) and navigation lockdown.
- **Embedded Database Architecture**:
  - High-performance SQLite engine via `better-sqlite3` operating in Write-Ahead Logging (`WAL`) mode with foreign key constraints.
  - Versioned migration schema (`001_initial.sql`) establishing 25 relational tables and FTS5 full-text search.
  - Standalone and runtime migration runners (`scripts/migrate.js`).
- **Windows Filesystem Integration**:
  - Native Windows logical drive detection (`wmic logicaldisk`) reporting letters, labels, and capacity.
  - Safe directory traversal with sorting, hidden file detection, and attribute extraction.
  - OS-level file opening (`shell.openPath`) and folder revealing (`shell.showItemInFolder`).
- **Python AI Inference Subprocess**:
  - Line-delimited JSON-RPC worker protocol on standard input/output (`ai-worker/src/main.py`).
  - Fast cryptographic hashing (SHA-256, MD5) and 8x8 perceptual difference hashing (`dHash`).
  - EXIF header parsing (`DateTimeOriginal`, camera make/model) and GPS DMS-to-decimal coordinate conversion.
  - Face detection, bounding box normalization, and pairwise cosine distance clustering.
  - Downscaled JPEG thumbnail generation with pure-Python fallbacks.
- **Frontend Architecture & Design System**:
  - React 18 UI mounted with `ReactDOM.createRoot` and bundled with Vite 6.
  - Windows 11 Fluent dark charcoal aesthetic, neon-lime accents, and glassmorphism tokens.
  - Type-safe renderer API bridge with mock fallback for browser testing.
  - Scoped Zustand state stores for navigation, explorer, jobs, dashboard, people, and watchers.
- **12 Specialized UI Views**:
  - `DashboardPage`: Real-time KPI counters, quick shortcuts, and database telemetry.
  - `ExplorerPage`: Logical drive selector, breadcrumb trail, forward/back navigation, list/grid toggle, and file selection.
  - `PeoplePage`: Face cluster review, identity naming, status filters (unreviewed, reviewed, confirmed), hide, and delete.
  - `SearchPage`: High-speed multi-parameter search (text, extension, date range, size) with execution timing.
  - `TimelinePage`: Chronological media grouping by Year, Month, or Day derived from EXIF timestamps.
  - `EventsPage`: Events container layout with event creation workflow guidance.
  - `DuplicatesPage`: Side-by-side comparison of duplicate candidates, exact vs perceptual filtering, and resolution actions (Keep Best, Move to Trash, Hardlink).
  - `StoragePage`: Physical drive capacity meters, space allocation breakdown, and heaviest file locator.
  - `ActivityPage`: Live background task queue monitor with pause, resume, cancel, and error logs.
  - `HistoryPage`: Operation audit log with one-click reversible rollback.
  - `WatchedFoldersPage`: Directory watcher management with native folder dialog and auto-index toggling.
  - `SettingsPage`: AI model confidence sliders, cluster distance thresholds, library path picker, and diagnostics.
- **Testing & Verification**:
  - Vitest test runner configuration (`vitest.config.ts`).
  - Unit tests for Windows path normalization, null-byte injection detection, and default safety invariants.

### Fixed
- Fixed TypeScript compiler configuration in `tsconfig.json` and `tsconfig.main.json` to resolve deprecated `baseUrl` and module resolution errors under TypeScript 7+.
- Rebuilt native C++ addon `better-sqlite3` targeting Electron 33.4.11 ABI via `@electron/rebuild`.
- Corrected relative type import paths in renderer components and pages.
- Resolved TypeScript typing in `TimelinePage.tsx` for `Object.entries` mapping in strict mode.

### Security
- Implemented strict null-byte (`\0`) path validation and ID sanitization across all IPC handlers.
- Hardened Electron window security with `contents.setWindowOpenHandler` denial and `contents.on('will-navigate')` external URL interception.
- Enforced copy-first non-destructive semantics for all automated library reorganizations.
