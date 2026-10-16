# Actionable Engineering Tasks

## Product: Nexora — AI File Manager
**Tagline:** *"Your files. Your intelligence. Your control."*  
**Version:** 0.1.0  
**Tracking Status:** Synchronized with v0.1.0 codebase  

---

## Task Priority Definitions
- **P0 (Critical)**: Fundamental functionality required for operation, stability, data integrity, or security.
- **P1 (High)**: Core product features delivering primary user value.
- **P2 (Medium)**: Enhancements, optimizations, and secondary quality-of-life improvements.

---

## 1. Architecture, Configuration & Security

| Task ID | Description | Priority | Status | Dependencies | Completion Criteria |
| :--- | :--- | :---: | :---: | :--- | :--- |
| `ARCH-01` | Establish Dual TypeScript configuration (`tsconfig.json` & `tsconfig.main.json`) | P0 | **Completed** | None | `tsc --noEmit` and `tsc -p tsconfig.main.json --noEmit` pass with zero errors. |
| `ARCH-02` | Implement Electron window management with strict security controls | P0 | **Completed** | `ARCH-01` | `contextIsolation: true`, `nodeIntegration: false`, external window blocking enabled in [src/main/index.ts](file:///e:/Code%20Tresure/File%20manager/src/main/index.ts). |
| `ARCH-03` | Enforce strict Content Security Policy (`CSP`) | P0 | **Completed** | `ARCH-02` | CSP meta tag restricts script execution to `'self'` without unapproved remote sources. |
| `ARCH-04` | Rebuild native C++ bindings for Electron ABI | P0 | **Completed** | `ARCH-01` | `better-sqlite3` native addon loads successfully in Electron 33 runtime. |
| `ARCH-05` | Configure Comprehensive `.gitignore` | P1 | **Completed** | None | Excludes `node_modules`, `dist`, `.data`, `release`, Python bytecode, and OS caches. |

---

## 2. Database & Data Model

| Task ID | Description | Priority | Status | Dependencies | Completion Criteria |
| :--- | :--- | :---: | :---: | :--- | :--- |
| `DB-01` | Author Initial SQLite Schema (`001_initial.sql`) with 25 tables | P0 | **Completed** | None | Tables for roots, files, people, faces, jobs, tags, operations, and settings created with foreign keys. |
| `DB-02` | Configure SQLite WAL mode, foreign keys, and busy timeout | P0 | **Completed** | `DB-01` | Pragmas `journal_mode = WAL`, `foreign_keys = ON`, `busy_timeout = 5000` applied on initialization. |
| `DB-03` | Build Automated & Standalone Migration Runner | P1 | **Completed** | `DB-01` | Migrations run idempotently at runtime via `initDatabase()` and standalone via [scripts/migrate.js](file:///e:/Code%20Tresure/File%20manager/scripts/migrate.js). |
| `DB-04` | Implement FTS5 Full-Text Search Virtual Table | P1 | **Completed** | `DB-01` | `search_index` virtual table tokenizes filename, path, tags, and OCR text using `unicode61`. |
| `DB-05` | Implement Transactional File Operations & Rollback Log | P1 | **Completed** | `DB-01` | `operation_history` records reversible file copy transactions. |

---

## 3. Filesystem & IPC Communication

| Task ID | Description | Priority | Status | Dependencies | Completion Criteria |
| :--- | :--- | :---: | :---: | :--- | :--- |
| `FS-01` | Implement Windows Logical Drive Discovery | P0 | **Completed** | None | Queries drives via `wmic logicaldisk`, returning letters, volume labels, and free/used space. |
| `FS-02` | Implement Safe Directory Traversal & Filtering | P0 | **Completed** | `FS-01` | Reads files/folders with attributes (size, modified, hidden, extension) and sorting support. |
| `FS-03` | Implement OS File Launch & Explorer Reveal | P1 | **Completed** | None | Integrates `shell.openPath()` and `shell.showItemInFolder()`. |
| `FS-04` | Create Type-Safe IPC Handler Registry with Sanitization | P0 | **Completed** | `FS-02`, `DB-02` | All IPC channels validate paths against null bytes (`\0`) and format IDs. |
| `FS-05` | Build Secure Preload Bridge (`window.electronAPI`) | P0 | **Completed** | `FS-04` | Type-safe context bridge exposed in [src/preload/index.ts](file:///e:/Code%20Tresure/File%20manager/src/preload/index.ts). |

---

## 4. Python AI Inference Engine

| Task ID | Description | Priority | Status | Dependencies | Completion Criteria |
| :--- | :--- | :---: | :---: | :--- | :--- |
| `AI-01` | Build Subprocess JSON-RPC Protocol on stdin/stdout | P0 | **Completed** | None | Bidirectional unbuffered JSON communication responding to `ping` and commands. |
| `AI-02` | Implement SHA-256 and Perceptual Difference Hashing (`dHash`) | P1 | **Completed** | `AI-01` | Computes 64-char SHA-256 and 16-char hex perceptual image difference hash. |
| `AI-03` | Implement EXIF Header & GPS Coordinate Extraction | P1 | **Completed** | `AI-01` | Extracts `DateTimeOriginal`, camera make/model, and decodes GPS DMS to decimal degrees. |
| `AI-04` | Implement Face Detection & Cosine Distance Clustering | P1 | **Completed** | `AI-01` | Normalizes bounding boxes and clusters embeddings based on customizable distance threshold. |
| `AI-05` | Implement Downscaled JPEG Thumbnail Generator | P1 | **Completed** | `AI-01` | Generates 256x256 thumbnails for fast UI rendering. |
| `AI-06` | Integrate Pure-Python Fallback Implementation | P0 | **Completed** | `AI-01` | Subprocess executes cleanly on bare Python installations without requiring compiled ML binaries. |

---

## 5. Frontend UI & Specialized Pages

| Task ID | Description | Priority | Status | Dependencies | Completion Criteria |
| :--- | :--- | :---: | :---: | :--- | :--- |
| `UI-01` | Author Windows 11 Dark Charcoal & Neon-Lime Design Tokens | P1 | **Completed** | None | [tokens.css](file:///e:/Code%20Tresure/File%20manager/src/renderer/styles/tokens.css) & [global.css](file:///e:/Code%20Tresure/File%20manager/src/renderer/styles/global.css) with glassmorphism and typography tokens. |
| `UI-02` | Implement Scoped Zustand State Stores & API Service Bridge | P0 | **Completed** | `FS-05` | Stores for navigation, explorer, jobs, people, dashboard, and watchers with mock fallback. |
| `UI-03` | Build Master Application Shell (`App.tsx`) with Topbar & Modals | P0 | **Completed** | `UI-01`, `UI-02` | Header with breadcrumbs, quick search input, active jobs pill, and Index Folder modal. |
| `UI-04` | Implement Dashboard Page (`DashboardPage.tsx`) | P1 | **Completed** | `UI-02` | Live KPI cards, quick navigation shortcuts, and database telemetry. |
| `UI-05` | Implement File Explorer Page (`ExplorerPage.tsx`) | P0 | **Completed** | `UI-02` | Drive selector, breadcrumb path, grid/list view, sorting, selection, and Explorer launch. |
| `UI-06` | Implement People Management Page (`PeoplePage.tsx`) | P1 | **Completed** | `UI-02` | Face cluster review, naming, status filters (unreviewed/reviewed/confirmed), hide, and delete. |
| `UI-07` | Implement Smart Search Page (`SearchPage.tsx`) | P1 | **Completed** | `UI-02` | Multi-filter search (query, extension, date range, size) with execution duration display. |
| `UI-08` | Implement Timeline View Page (`TimelinePage.tsx`) | P1 | **Completed** | `UI-02` | Chronological grouping by Year, Month, or Day derived from EXIF timestamps. |
| `UI-09` | Implement Events & Places Page (`EventsPage.tsx`) | P2 | **Completed** | `UI-02` | Events container with empty state and event creation guidance. |
| `UI-10` | Implement Duplicates Page (`DuplicatesPage.tsx`) | P1 | **Completed** | `UI-02` | Side-by-side duplicate comparison, exact vs perceptual filtering, and resolution actions. |
| `UI-11` | Implement Storage Analytics Page (`StoragePage.tsx`) | P1 | **Completed** | `UI-02` | Physical drive capacity meters, space allocation breakdown, and heaviest files table. |
| `UI-12` | Implement Background Activity Page (`ActivityPage.tsx`) | P1 | **Completed** | `UI-02` | Live task queue progress bars, pause/resume/cancel controls, and error logs. |
| `UI-13` | Implement History & Rollback Page (`HistoryPage.tsx`) | P1 | **Completed** | `UI-02` | Reorganization audit log with one-click undo/rollback controls. |
| `UI-14` | Implement Watched Folders Page (`WatchedFoldersPage.tsx`) | P1 | **Completed** | `UI-02` | Directory watcher management with native folder dialog and auto-index toggling. |
| `UI-15` | Implement Settings Page (`SettingsPage.tsx`) | P1 | **Completed** | `UI-02` | AI confidence sliders, cluster distance thresholds, library path picker, and diagnostics. |

---

## 6. Testing, Quality Assurance & Packaging

| Task ID | Description | Priority | Status | Dependencies | Completion Criteria |
| :--- | :--- | :---: | :---: | :--- | :--- |
| `QA-01` | Setup Vitest Configuration & Global Test Runner | P0 | **Completed** | None | [vitest.config.ts](file:///e:/Code%20Tresure/File%20manager/vitest.config.ts) configured with Node environment and path aliases. |
| `QA-02` | Write Filesystem Safety & Normalization Unit Tests | P1 | **Completed** | `QA-01` | Tests verify path normalization, null-byte detection, and drive root parsing. |
| `QA-03` | Write Default Settings & Contract Invariant Unit Tests | P1 | **Completed** | `QA-01` | Tests verify safety constants, theme defaults, and hash verification requirements. |
| `QA-04` | Execute Full Verification Pipeline (`typecheck`, `test`, `build`) | P0 | **Completed** | `QA-02`, `QA-03` | All TypeScript checks pass; all tests pass; renderer and main bundles build with zero errors. |
| `QA-05` | Windows NSIS Installer Packaging Verification | P2 | Planned | `QA-04` | `npm run package` builds standalone `.exe` installer. |
| `QA-06` | Integration Test Suite for SQLite IPC Queries | P2 | Planned | `QA-04` | Automated test verifies concurrent insert and FTS5 search queries. |

---

## 7. Documentation & Version Management System

| Task ID | Description | Priority | Status | Dependencies | Completion Criteria |
| :--- | :--- | :---: | :---: | :--- | :--- |
| `DOC-01` | Establish Canonical Version Source of Truth | P0 | **Completed** | None | Root [VERSION](file:///e:/Code%20Tresure/File%20manager/VERSION) established at `0.1.0` and aligned with [package.json](file:///e:/Code%20Tresure/File%20manager/package.json). |
| `DOC-02` | Implement Version Management & Release Workflow | P1 | **Completed** | `DOC-01` | Defined 9-step version update workflow and SemVer standards in [CONTRIBUTING.md](file:///e:/Code%20Tresure/File%20manager/CONTRIBUTING.md). |
| `DOC-03` | Author Domain-Specific Engineering Specifications | P1 | **Completed** | None | Created [FILE_OPERATIONS.md](file:///e:/Code%20Tresure/File%20manager/FILE_OPERATIONS.md), [AI_PIPELINE.md](file:///e:/Code%20Tresure/File%20manager/AI_PIPELINE.md), [PRIVACY_SECURITY.md](file:///e:/Code%20Tresure/File%20manager/PRIVACY_SECURITY.md), [SEARCH_DUPLICATES.md](file:///e:/Code%20Tresure/File%20manager/SEARCH_DUPLICATES.md), [WATCH_FOLDERS.md](file:///e:/Code%20Tresure/File%20manager/WATCH_FOLDERS.md), [ERROR_HANDLING.md](file:///e:/Code%20Tresure/File%20manager/ERROR_HANDLING.md), [PERFORMANCE.md](file:///e:/Code%20Tresure/File%20manager/PERFORMANCE.md), [DEPENDENCIES.md](file:///e:/Code%20Tresure/File%20manager/DEPENDENCIES.md), and [UI_UX_SPEC.md](file:///e:/Code%20Tresure/File%20manager/UI_UX_SPEC.md). |
| `DOC-04` | Maintain Chronological Release History in Changelog | P1 | **Completed** | `DOC-01` | Formatted [CHANGELOG.md](file:///e:/Code%20Tresure/File%20manager/CHANGELOG.md) adhering to Keep a Changelog standards. |
