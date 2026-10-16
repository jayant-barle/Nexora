# Changelog

All notable changes to the **Nexora** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

### [0.3.1] — 2026-10-17

**Added**
- **Mandatory Rule: Filename, Duplicate Detection & Person Identification Invariants**:
  - **Autonomous Canonical File Identity (`src/main/organizer.ts`)**: Every file is treated as a distinct entity based on its canonical path and database identity. Identical filenames across distinct folders or directories are never automatically classified as duplicates or associated with the same person.
  - **Explicit User-Defined Filename Tokens (`src/main/organizer.ts`)**: Added support for `{filename}`, `{basename}`, `{name}`, `{ext}`, `{extension}` in organization rules. Unresolved or ambiguous rule tokens safely fallback to `General` with explicit warning logs.
  - **Strict Non-Inference of Person Identities from Filenames (`src/main/organizer.ts`)**: Under no circumstance is a person's identity inferred from a filename alone (e.g. `Alice_party.jpg` does not associate with person `Alice`). Person assignment requires verified face recognition or explicit user review.
  - **Confirmed Review Status Gating & Safe Fallback (`src/main/organizer.ts`)**: Person folder proposals strictly require `review_status IN ('confirmed', 'reviewed')` or `association_type = 'confirmed'`. Unreviewed or uncertain face matches safely resolve to `Unassigned` with explanatory warnings.
  - **Multi-Person Aggregation in Images & Videos (`src/main/organizer.ts`)**: Upgraded organization proposal query to aggregate all distinct confirmed people in a file (e.g. `People/Alice & Bob/`), supporting multiple confirmed individuals per image.
  - **Cryptographic Exact Duplicate Verification (`src/main/indexer.ts`, `src/main/file-operations.ts`)**: Duplicate detection strictly verifies byte-for-byte SHA-256 content hashes, never relying solely on filenames, sizes, extensions, or timestamps. Duplicate candidates remain pending user review (`status = 'pending'`) and are never automatically deleted or overwritten. Separate source paths and database records are preserved for identical files.
  - **In-Flight Stream Modification Detection (`src/main/file-operations.ts`, `ai-worker/src/main.py`)**: Hashing (`computeFileSha256`) and copying (`copyFileWithVerification`) now perform `stat` comparisons before and after stream operations. Concurrent modifications in-flight trigger aborts, unlinking of temporary staging files (`.nexora-tmp-*`), and error reporting without corrupting targets or modifying originals.
  - **Comprehensive Test Suite (`tests/unit/mandatory-rules.test.ts`)**: Added 7 unit tests covering identical filenames with different contents, different filenames with identical contents, files showing different confirmed people, multiple confirmed people aggregation, uncertain face matches, explicit filename tokens with safe fallbacks, and in-flight file modification detection. All 51 tests across 10 test suites pass with 100% success rate.

---

### [0.3.0] — 2026-10-17

**Added**
- **Production-Ready Metadata Intelligence Engine (`ai-worker/src/main.py`)**:
  - Modular local-only extraction pipeline for common file types with zero cloud dependence.
  - **Images**: Local EXIF extraction (capture date/time, camera make, camera model, lens model, orientation, ISO, focal length, aperture, exposure time, GPS coordinates, dimensions).
  - **Videos**: Resolution (width/height), duration, frame rate, FourCC video codec, container format, and keyframe face sampling.
  - **Documents**: Safe PDF parser (%PDF- header validation, encryption detection, metadata dictionary title/author/subject, page count, and 3KB text preview); Office OpenXML (DOCX, PPTX, XLSX) read-only zip/xml parser reading Dublin Core title, creator, subject/description, page/word counts, and sample text without executing macros or embedded scripts.
  - **Audio**: WAV RIFF stream parameter extractor (sample rate, channels, byte rate, bitrate, duration); MP3 ID3v2 tag parser (TIT2 title, TPE1 artist, TALB album) and MPEG frame duration estimation; FLAC STREAMINFO metadata.
  - **Archives**: Safe ZIP and TAR entry inspection with password-encryption detection.
  - **Plaintext & Code**: Line counts, word counts, UTF-8/Latin-1 encoding detection, and text preview snippets.
  - **Sandboxing & Error Isolation**: Explicit detection and classification of corrupt, password-encrypted, or unsupported files (`status: 'corrupt' | 'encrypted' | 'unsupported'`) without terminating scans or failing unrelated jobs.
- **Database Schema Migration 002 (`database/migrations/002_metadata_intelligence.sql`)**:
  - Extends `files` table with 24 dedicated metadata columns (`camera_make`, `camera_model`, `lens_model`, `iso`, `focal_length`, `aperture`, `exposure_time`, `orientation`, `codec`, `frame_rate`, `bitrate`, `page_count`, `word_count`, `doc_title`, `doc_author`, `doc_subject`, `audio_artist`, `audio_album`, `audio_title`, `archive_entries`, `is_missing`, `availability_status`, `extractor_version`, `extracted_at`).
  - Added indexes on `(camera_make, camera_model)`, `doc_author`, `audio_artist`, `is_missing`, and `availability_status`.
  - Created `organization_rules` table with 5 default presets and `organization_proposals` table.
  - Incremented `schema_version` to 2.
- **Incremental Scanning & Missing File Reconciliation (`src/main/indexer.ts`)**:
  - Incremental scanning skips 100% of unchanged files by validating file modification time and byte size against stored fingerprints.
  - Added `forceFullRescan` option to force complete re-extraction on demand.
  - Non-destructive missing file reconciliation: files missing from disk are marked `is_missing = 1`, `availability_status = 'missing'` without deleting database records or user tags. Files returning to disk automatically restore to `is_missing = 0`, `availability_status = 'available'`.
  - Synchronizes FTS5 `search_index` with extracted document text previews, camera details, authors, and artists.
- **Metadata-Based Organization & Preview Engine (`src/main/organizer.ts`)**:
  - Configurable pattern rule engine supporting combinations of `{category}`, `{YYYY}`, `{MM}`, `{DD}`, `{person}`, `{camera}`, `{location}`, `{event}`, `{author}`.
  - Deterministic fallbacks for missing metadata (`Unknown Date`, `Unassigned`, `Unknown Location`, `General`, `Unknown Camera`, `Unknown Author`, `Other Files`).
  - Operation preview generator providing proposed destinations, rule explanations, collision warnings (`filename (1).ext`), duplicate detection avoiding redundant copies, and storage metrics.
  - Verified copy execution via `executeOrganization` integrating atomic staging, pre/post SHA-256 verification, and rollback protection. Original files remain untouched and immutable.
- **Search Integration (`src/main/database.ts`)**:
  - Multi-parameter search filtering by category (`image`, `video`, `document`, `audio`, `archive`, `text`, `other`), camera make/model, document author, audio artist, GPS availability, missing file status, and FTS5 full-text matching.
- **IPC & Renderer Bridge (`src/main/ipc-handlers.ts`, `src/preload/index.ts`, `src/renderer/services/api.ts`)**:
  - Exposing `organizer:get-rules`, `organizer:save-rule`, `organizer:generate-proposals`, `organizer:execute`, `library:reconcile`, and `library:rescan`.
- **Automated Test Coverage (`tests/`)**:
  - Added `tests/unit/metadata-extraction.test.ts` (8 tests) verifying PDF, Office, audio, archive, text, corrupt/encrypted detection, and read-only execution safety.
  - Added `tests/unit/organizer.test.ts` (6 tests) verifying token resolution, deterministic fallbacks, collision avoidance, and atomic copy.
  - Added `tests/integration/metadata-intelligence.test.ts` (3 tests) verifying incremental cache hits, missing file non-destructive reconciliation, and rich search queries.
  - All 44 tests across 9 test suites passing with 100% pass rate.

---

### [0.2.0] — 2026-10-16

**Added**
- **Safe Copy-First Operations Engine (`src/main/file-operations.ts`)**:
  - Pre-copy and post-copy SHA-256 cryptographic verification for all file operations.
  - Non-destructive destination collision handling (`filename (1).ext`) without overwriting existing files.
  - Fast free disk space validation via native `fs.statfsSync` before initiating file transfers.
  - Two-stage atomic copying via temporary files (`.nexora-tmp-*`) with atomic rename.
  - Reversible rollback engine (`revertBatchOperation`) with modified-file protection (detects if user modified a managed copy and prevents deletion).
  - Database operation journaling in `copy_operations`, `operation_items`, and `operation_history`.
- **Python AI Inference Worker Subprocess (`src/main/ai-worker-client.ts` & `ai-worker/src/main.py`)**:
  - Native OpenCV 5.0 and NumPy 2.5.2 acceleration for local AI tasks.
  - Multi-face detection with normalized bounding boxes, skin-color segmentation, and Laplacian sharpness scoring.
  - Vectorized pairwise cosine distance clustering with configurable similarity thresholds.
  - Video frame sampling engine (`analyze_video`) indexing timestamps, frame numbers, and observed faces.
  - Chunked 64KB cryptographic hashing (SHA-256, MD5) and 8x8 perceptual difference hashing (`dHash`).
  - Worker lifecycle management: health check pings, timeouts, and auto-restart on unexpected crashes with backoff.
- **High-Performance Incremental Indexer (`src/main/indexer.ts`)**:
  - Smart incremental scanning: checks cached `mtime` and `size_bytes` to instantly skip unchanged files.
  - Batched SQLite transactions (50 files/transaction) avoiding main thread and SQLite locking bottlenecks.
  - Automatic FTS5 `search_index` synchronization during indexing passes.
  - Duplicate detection engine distinguishing exact SHA-256 bit-for-bit duplicates (`exact`) from perceptual visual similarity candidates (`visual_similarity`).
- **Persistent Background Job Runner (`src/main/job-runner.ts`)**:
  - Persistent job queue supporting `folder_scan`, `batch_copy`, and `face_clustering`.
  - Priority-based job dequeuing, pause, resume, and cancellation token support.
  - Real-time IPC progress telemetry (`job:progress`, `job:completed`, `job:failed`).
  - Structured error logging to `job_errors` table for transparent troubleshooting.
- **Real-Time Filesystem Watcher (`src/main/watcher.ts`)**:
  - Chokidar-powered background monitoring with a 500ms sliding debounce window.
  - Automatic indexing job dispatch upon file additions or modifications.
  - Exclusions for dotfiles, `.git`, `node_modules`, and Windows system volume folders.
- **Database Maintenance & Health APIs (`src/main/database.ts`)**:
  - `checkDatabaseIntegrity()` running `PRAGMA integrity_check`.
  - `vacuumDatabase()` executing SQLite `VACUUM` for database compaction.
  - `rebuildSearchIndex()` for full FTS5 search index synchronization.
  - `resolveDuplicateGroup()` with support for `keep_best`, `recycle`, and `hardlink` actions.
  - `mergePeople()` transactional identity consolidation across face clusters and file links.
- **Comprehensive Unit & Integration Test Suite (`tests/`)**:
  - 27 automated tests passing across 6 suites (`filesystem`, `types`, `database`, `file-operations`, `ai-pipeline`, `indexer-pipeline`).
  - Verification of copy verification, original immutability, undo rollback, modified copy protection, face clustering, duplicate distinction, and incremental caching.

**Changed**
- Replaced deprecated and slow Windows `wmic` drive queries with instantaneous native `fs.statfsSync`.
- Replaced mock AI worker placeholders with live Python JSON-RPC worker client.
- Orchestrated graceful startup and shutdown of `AiWorkerClient`, `JobRunner`, `WatcherService`, and SQLite database in Electron `main/index.ts`.

---

### [0.1.0] — 2026-10-16

**Added**
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

**Fixed**
- Fixed TypeScript compiler configuration in `tsconfig.json` and `tsconfig.main.json` to resolve deprecated `baseUrl` and module resolution errors under TypeScript 7+.
- Rebuilt native C++ addon `better-sqlite3` targeting Electron 33.4.11 ABI via `@electron/rebuild`.
- Corrected relative type import paths in renderer components and pages.
- Resolved TypeScript typing in `TimelinePage.tsx` for `Object.entries` mapping in strict mode.

**Security and Privacy**
- Implemented strict null-byte (`\0`) path validation and ID sanitization across all IPC handlers.
- Hardened Electron window security with `contents.setWindowOpenHandler` denial and `contents.on('will-navigate')` external URL interception.
- Enforced copy-first non-destructive semantics for all automated library reorganizations.
- 100% local processing guarantee with zero cloud telemetry and air-gapped biometric storage.

**Documentation**
- Established canonical version source of truth in root `VERSION` file (`0.1.0`).
- Authored domain-specific engineering specifications:
  - `FILE_OPERATIONS.md`: Copy operations, original-file preservation, verification, undo, and rollback.
  - `AI_PIPELINE.md`: Local AI models, JSON-RPC subprocess worker, inference, indexing, and face-recognition workflows.
  - `PRIVACY_SECURITY.md`: Local-only processing, sensitive metadata, permissions, and Electron security hardening.
  - `SEARCH_DUPLICATES.md`: Search indexing, FTS5 tokenization, and exact/perceptual duplicate-handling rules.
  - `WATCH_FOLDERS.md`: Chokidar folder monitoring, event debouncing, and startup reconciliation.
  - `ERROR_HANDLING.md`: Multi-layer error reporting, database transactions, and crash recovery.
  - `PERFORMANCE.md`: Large-library performance, database WAL tuning, and 60 FPS rendering.
  - `DEPENDENCIES.md`: Dependency inventory, license compliance analysis, and native ABI maintenance.
  - `UI_UX_SPEC.md`: Screen-by-screen specifications for all 12 views, design tokens, and interactions.
- Updated `CONTRIBUTING.md` with the mandatory 9-step Version Update Workflow and SemVer guidelines.
- Updated `README.md`, `PRD.md`, `ARCHITECTURE.md`, `TASKS.md`, and `docs/` cross-referencing all technical specifications.

**Affected Areas**
- Root configuration and version files (`VERSION`, `package.json`, `.gitignore`)
- Main process (`src/main/index.ts`, `src/main/database.ts`, `src/main/filesystem.ts`, `src/main/ipc-handlers.ts`)
- Preload bridge (`src/preload/index.ts`)
- Renderer application (`src/renderer/App.tsx`, `src/renderer/components/Sidebar.tsx`, 12 view pages, Zustand stores, styles)
- Python worker (`ai-worker/src/main.py`, `ai-worker/requirements.txt`)
- Database migrations (`database/migrations/001_initial.sql`, `scripts/migrate.js`)
- Comprehensive documentation suite (all 20 markdown specification documents)

**Validation**
- `npm test`: 2 test files, 6 unit tests executed and passed (`tests/unit/filesystem.test.ts`, `tests/unit/types.test.ts`).
- `npm run typecheck`: TypeScript compiler checks executed with zero type errors.
- `npm run build`: Production bundle for Vite renderer and Electron main compiled cleanly.
- IPC path validation: Null-byte rejection and path normalization verified.
