# Product Requirements Document (PRD)

## Product: Nexora — AI File Manager
**Tagline:** *"Your files. Your intelligence. Your control."*  
**Document Version:** 1.3.0  
**Status:** Implemented (v0.3.1 Mandatory Rule: Filename, Duplicate Detection & Person Identification Release) / Production-Ready  
**Target Platform:** Windows 11 (x64) desktop  
**Execution Model:** Local-First, Offline, Zero-Cloud Telemetry  
**Visual Identity:** Cinematic, futuristic, minimal; black and charcoal surfaces with restrained neon-lime accents and subtle glass effects  

---

## 1. Executive Summary & Problem Statement

### 1.1 The Problem
Standard desktop file explorers (such as default Windows File Explorer) were architected decades ago for rigid directory hierarchies. As users accumulate terabytes of digital photos, high-definition videos, downloaded records, and creative assets, legacy file managers fail in fundamental ways:
- **Zero Content Intelligence**: File search is confined to filename substrings. Locating "photos of family in mountains 2022" requires hours of manual directory digging.
- **Uncontrolled Duplication**: Duplicate files accumulate across storage drives, phone dumps, and external backups, wasting high-speed SSD capacity without safe deduplication mechanisms.
- **Privacy Trade-offs in Cloud Services**: Cloud platforms (Google Photos, Apple iCloud, OneDrive) offer face clustering and semantic search, but demand uploading private, sensitive personal media to remote servers, incurring subscription fees and data sovereignty risks.
- **Destructive Reorganization Hazards**: Traditional sorting utilities often execute irreversible move or overwrite operations, risking permanent data loss during partial transfers.

### 1.2 The Solution: Nexora
**Nexora** is an intelligent, local-first Windows 11 desktop application that unites traditional Windows filesystem browsing with private, on-device artificial intelligence. Nexora indexes files locally in a high-speed SQLite database, executes facial recognition and clustering via a local Python engine, identifies exact and perceptual duplicates, and organizes media through safe, copy-based operations with mandatory SHA-256 checksum verification and one-click rollback.

---

## 2. Branding & Visual Identity

- **Official Name**: Nexora
- **Subtitle**: AI File Manager
- **Tagline**: *"Your files. Your intelligence. Your control."*
- **Visual Aesthetic**:
  - Surfaces: Deep obsidian and charcoal (`#0a0a0a`, `#111111`, `#141414`).
  - Accent Color: Restrained neon-lime (`#b4ff32` with subtle glow effects).
  - Materials: Translucent glassmorphism (`backdrop-filter: blur(12px)`), clean 1px borders (`#2a2a2a`).
  - Typography: Modern geometric sans-serif (Inter) paired with Cascadia/JetBrains Mono for filesystem paths.
- **Distribution & Trademark**:
  - Packaged Application ID: `com.nexora.app`
  - Windows Executable Product Name: `Nexora`
  - Trademark Clearance: Namespace clearance conducted for application package distributors.

---

## 3. Target Users & Use Cases

### 3.1 Target Personas
1. **The Family Archivist**: Individuals managing decades of family photos and home videos scattered across phone backups, USB sticks, and external hard drives. Needs to locate specific relatives without cloud uploads.
2. **The Content Creator / Photographer**: Photographers and videographers capturing thousands of RAW/JPEG images and clips per session. Needs rapid deduplication, EXIF timeline browsing, and storage breakdown.
3. **The Privacy-Conscious Power User**: Users who refuse cloud scanning of their personal records and photos, requiring 100% on-device AI inference with zero network requests.

### 3.2 Key User Journeys
- **Journey 1: Indexing a Folder**: User clicks "Index Folder", selects a directory (e.g. `D:\Photos 2023`), and Nexora scans all files in the background, computing hashes, extracting EXIF dates/GPS, and detecting faces without freezing the UI.
- **Journey 2: Finding Photos of a Person**: User navigates to the "People" view, sees automatically clustered face thumbnails, assigns a name to an unreviewed face (e.g., "Sarah"), and clicks on Sarah to view all associated photos across all indexed drives.
- **Journey 3: Cleaning Disk Space**: User navigates to the "Duplicates" view, views identified duplicate groups, compares side-by-side previews, and chooses "Keep Best Quality" or "Move to Trash".
- **Journey 4: Timeline Browsing**: User navigates to the "Timeline" view and browses media chronologically grouped by Year, Month, or Day extracted from camera EXIF timestamps.

---

## 4. Product Goals & Non-Goals

### 4.1 Primary Goals
- **100% Local Privacy**: Zero external API calls for media analysis. All face embeddings, clustering, hashing, and metadata parsing occur on the local CPU/GPU.
- **Non-Destructive Guarantee**: Original source files in scanned directories are never moved, renamed, or modified without explicit user confirmation. Library organization uses copy-first semantics.
- **Responsive Desktop Performance**: Electron main process and React UI must never block during heavy AI analysis or multi-gigabyte disk scans. All heavy processing is delegated to background worker queues and subprocesses.
- **Windows 11 Fluent Design**: Provide a premium dark-mode interface aligned with Windows 11 aesthetics, featuring smooth transitions, glassmorphic surfaces, and legible typography.

### 4.2 Non-Goals (Out of Scope for v1)
- Cloud synchronization or remote server backups.
- Direct RAW camera file editing (non-destructive photo editing suite).
- Multi-user network collaboration over LAN.
- Mobile companion applications (iOS / Android).

---

## 5. Functional Requirements

### 5.1 Filesystem & Navigation (`FR-01`)
- **FR-01.1**: The system must detect and list all logical Windows drives (`C:`, `D:`, etc.) with volume labels, filesystem types, used space, and free space.
- **FR-01.2**: The system must provide a two-pane or breadcrumb-based directory browser capable of traversing nested Windows directories.
- **FR-01.3**: The explorer must support sorting by Name, Date Modified, Size, and Extension in ascending and descending orders.
- **FR-01.4**: Users must be able to toggle between Grid View (with thumbnails) and List View (with metadata columns).
- **FR-01.5**: The system must provide an action to "Reveal in Windows File Explorer" (`shell.showItemInFolder`) and "Open File" (`shell.openPath`).

### 5.2 Metadata & EXIF Extraction (`FR-02`)
- **FR-02.1**: The system must extract image dimensions (width, height), format, file size, and file creation/modification timestamps.
- **FR-02.2**: The system must parse EXIF `DateTimeOriginal` / `DateTime` to establish true capture timestamps.
- **FR-02.3**: The system must extract GPS latitude, longitude, and altitude from EXIF tags when present.
- **FR-02.4**: The system must generate and persist downscaled JPEG thumbnails (256x256) for quick grid rendering.

### 5.3 Facial Recognition & Clustering (`FR-03`)
- **FR-03.1**: The system must detect human faces in indexed images and store normalized bounding boxes (`x`, `y`, `width`, `height`) and confidence scores.
- **FR-03.2**: The system must extract vector embeddings for detected faces.
- **FR-03.3**: The system must cluster face embeddings using cosine distance thresholding to aggregate identical individuals.
- **FR-03.4**: The system must provide a People management interface supporting:
  - Renaming person clusters (assigning human names).
  - Review status workflow (`unreviewed` -> `reviewed` -> `confirmed`).
  - Hiding or excluding low-quality or irrelevant face clusters.
  - Deleting or merging clusters.

### 5.4 Search & Filtering (`FR-04`)
- **FR-04.1**: The system must maintain an FTS5 full-text search index covering filenames, paths, tags, and OCR text.
- **FR-04.2**: The Search view must support combined filtering by:
  - Free-text query.
  - File extension (e.g. `jpg, png, mp4`).
  - Date ranges (From / To).
  - File size range (Min / Max MB).
  - Person identity filter.
- **FR-04.3**: Search queries must return execution duration in milliseconds (`executionTimeMs`).

### 5.5 Deduplication & Reclaimable Space (`FR-05`)
- **FR-05.1**: The system must compute SHA-256 hashes to identify byte-for-byte exact file duplicates.
- **FR-05.2**: The system must compute perceptual difference hashes (`dHash`) to identify near-duplicate or burst photos.
- **FR-05.3**: The system must group duplicates and compute total wasted/reclaimable disk bytes.
- **FR-05.4**: The Duplicates view must provide side-by-side comparison of duplicate candidates.
- **FR-05.5**: The system must support resolution actions: Keep Best Quality, Keep Newest, Move to Trash, and NTFS Hardlink replacement.

### 5.6 Continuous Folder Watching (`FR-06`)
- **FR-06.1**: The system must allow users to register watched directories (`watch_roots`).
- **FR-06.2**: The watcher service must detect file additions, modifications, renames, and deletions using `chokidar`.
- **FR-06.3**: The watcher must debounce events (`watcherDebounceMs`, default 2000ms) to avoid thrashing during large file copies.
- **FR-06.4**: Users must be able to pause, resume, or remove watched folders.

### 5.7 Task Queue & Background Worker (`FR-07`)
- **FR-07.1**: Long-running operations (folder scanning, hashing, face detection, video analysis) must be queued as background jobs.
- **FR-07.2**: Jobs must track `progress`, `total`, `status` (`queued`, `running`, `paused`, `completed`, `failed`, `cancelled`), and `retry_count`.
- **FR-07.3**: The Activity view must display live job progress bars and offer pause, resume, and cancellation controls.
- **FR-07.4**: Failed jobs must log descriptive error messages to `job_errors`.

### 5.8 Safe Organization & Rollback (`FR-08`)
- **FR-08.1**: All automated file organization operations (Person-based sorting, Date-based sorting) must execute copy operations to a designated `managedLibraryPath`.
- **FR-08.2**: Each copy operation must record source path, destination path, and file size in `operation_items`.
- **FR-08.3**: When `hashVerification` is enabled, the system must verify source and destination SHA-256 hashes before marking an item as `verified`.
- **FR-08.4**: The system must maintain an audit log in `operation_history` and support one-click rollback.

### 5.9 Metadata Intelligence Engine & Organization (`FR-09`)
- **FR-09.1 (Modular Local Extraction)**: The system must extract metadata locally without cloud dependency across supported categories:
  - **Images**: EXIF capture date/time, camera make, camera model, lens model, orientation, ISO, focal length, aperture, exposure time, GPS coordinates, and technical properties.
  - **Videos**: Resolution (width/height), duration, frame rate, FourCC video codec, container format, and keyframe face sampling.
  - **Documents**: Safe PDF parser (%PDF- header validation, encryption detection, metadata dictionary title/author/subject, page count, and 3KB text preview); Office OpenXML (DOCX, PPTX, XLSX) read-only zip/xml parser reading Dublin Core title, creator, subject/description, page/word counts, and sample text preview.
  - **Audio**: WAV RIFF stream parameter extractor (sample rate, channels, byte rate, bitrate, duration); MP3 ID3v2 tag parser (TIT2 title, TPE1 artist, TALB album) and MPEG frame duration estimation; FLAC STREAMINFO metadata.
  - **Archives**: Safe ZIP and TAR entry inspection with password-encryption detection.
  - **Plaintext & Code**: Line counts, word counts, UTF-8/Latin-1 encoding detection, and text preview snippets.
- **FR-09.2 (Macro & Script Sandboxing)**: Metadata extraction must never execute file contents, macros, embedded scripts, or shell payloads; parsing must be strictly read-only structured container analysis.
- **FR-09.3 (Incremental Scanning & Caching)**: Scans must compare file size, modification timestamp, and stored fingerprints to skip unchanged files (100% cache hit reuse). Only invalidated files are reprocessed. A manual `forceFullRescan` option must force re-extraction on demand.
- **FR-09.4 (Non-Destructive Missing File Reconciliation)**: Discovered paths must be reconciled against the database. Missing files are flagged as `is_missing = 1`, `availability_status = 'missing'` without deleting database records, face links, or timeline history. Files returning to disk automatically restore availability (`is_missing = 0`).
- **FR-09.5 (Metadata-Based Organization Proposals)**: The system must propose folder hierarchies based on configurable pattern tokens (`{category}`, `{YYYY}`, `{MM}`, `{DD}`, `{person}`, `{camera}`, `{location}`, `{event}`, `{author}`). Missing metadata must resolve to deterministic fallbacks (`Unknown Date`, `Unassigned`, `Unknown Location`, `General`, `Unknown Camera`, `Unknown Author`, `Other Files`) without fabricating facts.
- **FR-09.6 (Preview & Verified-Copy Workflow)**: Mandatory user preview before copying displaying proposed paths, rule sources, collision warnings (`filename (1).ext`), duplicate detection avoiding redundant copies, and storage metrics. Operations execute atomic staging, pre/post SHA-256 verification, and rollback protection without modifying or deleting original files.
- **FR-09.7 (Metadata-Powered Search Integration)**: Search interface must support combined queries by category, camera make/model, document author, audio artist, GPS availability, missing file status, and FTS5 full-text matching.

### 5.10 Mandatory Invariants: Filename Handling, Duplicate Detection & Person Identification (`FR-10`)
- **FR-10.1 (Filename Handling & Canonical File Identity)**:
  - Every file is treated as a separate, autonomous entity by its canonical filesystem path and distinct database identifier (`files.id`).
  - Files with identical names across different directories or paths must never automatically be classified as duplicates or associated with the same person.
  - Filename and available metadata generate folder organization proposals immediately without waiting for face recognition or background clustering.
  - Explicit user-defined filename rule tokens (`{filename}`, `{basename}`, `{name}`, `{ext}`, `{extension}`) are fully supported.
  - Ambiguous or unresolved rule tokens trigger safety warnings and resolve to safe fallbacks (`General`).
- **FR-10.2 (Cryptographic Exact Duplicate Detection)**:
  - Exact duplicate status is strictly determined by cryptographic content hash (SHA-256).
  - Files are never classified as exact duplicates based solely on filename, file size, extension, or timestamps.
  - Inexpensive size checks narrow candidate pools before hashing when appropriate.
  - Hashing uses actual file contents and detects in-flight modifications between stream initiation and completion.
  - Separate source paths and database records are strictly maintained for every file even when contents are identical.
  - Duplicate candidates are never automatically deleted or overwritten; duplicates are registered in `duplicate_groups` with `status = 'pending'` for explicit user resolution.
- **FR-10.3 (Face Recognition & Person-Based Organization)**:
  - A person's identity is never inferred from a filename alone under any circumstance (e.g. `Alice_photo.jpg` does not assign person `Alice`).
  - Person identification relies exclusively on the local face detection, embedding extraction, vector clustering, and user review workflow.
  - Files are associated with a person in folder organization only when the match meets configured confidence requirements or has been confirmed by user review (`review_status IN ('confirmed', 'reviewed')` or `association_type = 'confirmed'`).
  - Uncertain or unreviewed face matches remain unassigned (`Unassigned` fallback) with warning notifications.
  - Multiple confirmed people in a single image or video are supported and aggregated (e.g. `People/Alice & Bob/`).
  - Folder organization proposals based on metadata are never blocked while face recognition jobs are queued or executing.
- **FR-10.4 (Safe Concurrent Processing & In-Flight Protection)**:
  - Filename analysis, metadata extraction, cryptographic hashing, thumbnail generation, search indexing, and face recognition run concurrently when dependencies permit.
  - Operations utilize the persistent SQLite job queue, transaction boundaries, deduplication, dependency tracking, and bounded concurrency.
  - In-flight file changes during hashing (`computeFileSha256`) or copying (`copyFileWithVerification`) are actively detected via pre/post stream stat comparisons. The operation aborts, deletes temporary staging files, and invalidates affected results without corrupting destinations.
  - Retries and application restarts are idempotent without creating duplicate records or redundant copy operations.
- **FR-10.5 (Original-File Preservation Guarantee)**:
  - Original source files are strictly immutable and preserved.
  - Organization operations follow a preview-and-confirm workflow before copying files into managed destinations.
  - Pre/post SHA-256 hash verification and in-flight source modification checks ensure file integrity before completing copy operations.
  - Source files are never silently moved, overwritten, or deleted.

---

## 6. Non-Functional Requirements (NFR)

### 6.1 Performance & Responsiveness
- **NFR-01**: Directory listings for up to 10,000 files in a single folder must render in under 300ms.
- **NFR-02**: Database searches on indexed libraries of 100,000 files must complete in under 50ms.
- **NFR-03**: The UI frame rate must maintain 60 FPS during background AI worker execution.
- **NFR-04**: SQLite must use Write-Ahead Logging (`PRAGMA journal_mode = WAL`) and a 5000ms busy timeout to prevent write-lock contention.

### 6.2 Security & Sandboxing
- **NFR-05**: Electron `BrowserWindow` must enforce `contextIsolation: true` and `nodeIntegration: false`.
- **NFR-06**: Renderer communication must only traverse approved IPC channels defined in `preload/index.ts`.
- **NFR-07**: All path arguments passed via IPC must be strictly validated against null bytes (`\0`) and path traversal exploits.
- **NFR-08**: A strict Content Security Policy (`CSP`) must prohibit execution of unapproved external scripts and object plugins.
- **NFR-09**: Window navigation must block external URLs (`will-navigate` interception and `setWindowOpenHandler` denial).

### 6.3 Reliability & Data Safety
- **NFR-10**: Crash resilience: If the Python AI worker crashes or receives a malformed file, the Electron main process must catch the failure, log the error to `job_errors`, and resume processing subsequent files.
- **NFR-11**: Database migrations must be atomic and version-tracked in `schema_version`.
- **NFR-12**: All file modifications must be strictly non-destructive; original source files must remain intact.

---

## 7. Implementation Status Matrix

| Module | Requirement | Status | Notes |
| :--- | :--- | :--- | :--- |
| **Explorer** | Logical Drive Listing | **Implemented** | Uses Windows native `fs.statfsSync` |
| **Explorer** | Directory Navigation & Breadcrumbs | **Implemented** | List and Grid views with sorting |
| **Database** | SQLite WAL Mode & Schema v2 | **Implemented** | 27 tables, versioned migration runner (001, 002) |
| **Database** | FTS5 Full-Text Search | **Implemented** | Covers filenames, paths, tags, OCR, text previews |
| **Metadata Engine** | Modular Local Extraction Pipeline | **Implemented** | Images, videos, PDF, Office, audio, archives, text |
| **Metadata Engine** | Sandboxing & Safe Container Parsing | **Implemented** | Read-only zip/xml without macro execution |
| **Incremental Scan** | Timestamp & Size Cache Reuse | **Implemented** | Bypasses unchanged files; supports force rescan |
| **Incremental Scan** | Missing File Non-Destructive Reconciliation | **Implemented** | Flags `is_missing = 1` without record deletion |
| **Organizer** | Metadata Token Rule Resolution | **Implemented** | Configurable templates with deterministic fallbacks |
| **Organizer** | Proposal Preview & Duplicate Avoidance | **Implemented** | Collision renaming and redundant copy skipping |
| **File Operations** | Verified Atomic Copy & Rollback Guard | **Implemented** | SHA-256 pre/post check, temp file staging, in-flight modification detection |
| **Search Engine** | Multi-Parameter Metadata Filtering | **Implemented** | Camera, author, artist, category, missing status |
| **AI Worker** | JSON-RPC Python Subprocess | **Implemented** | Over stdin/stdout with ping/hashes/meta |
| **AI Worker** | SHA-256 & Perceptual Hashing | **Implemented** | Native hashlib + PIL 8x8 dHash with in-flight stat checks |
| **AI Worker** | EXIF & GPS Metadata Extraction | **Implemented** | DateTimeOriginal, GPS coordinates |
| **AI Worker** | Face Detection & Clustering | **Implemented** | Bounding box & cosine distance clustering |
| **Mandatory Invariants** | Filename, Duplicate & Person Rules | **Implemented** | Canonical paths, non-inference of people, SHA-256 duplicate verification, multi-person support, in-flight modification guards |
| **UI Pages** | 12 Core Views (Dashboard, Explorer, etc.) | **Implemented** | Complete cinematic black/charcoal/lime UI |
| **Testing** | Automated Vitest Test Suite | **Implemented** | 51 tests passing across 10 test suites (100% pass) |

---

## 8. Acceptance Criteria

1. **Clean Installation & Build**: `npm install --ignore-scripts`, `npx electron-builder install-app-deps`, and `npm run build` execute without errors.
2. **Offline Execution**: Disconnecting network interfaces does not impair any application feature.
3. **Responsive UI**: Clicking across all 12 navigation tabs renders without visual artifacts or console exceptions.
4. **Data Integrity**: Indexing folders creates indexed records without modifying original files on disk.
5. **Deduplication Verification**: Given identical duplicate files, the system identifies identical SHA-256 hashes and offers non-destructive resolution.
6. **Product Branding**: The application window, installer, metadata, and documentation consistently display the name **Nexora**.

---

## 9. Related Engineering Specifications

- [ARCHITECTURE.md](file:///e:/Code%20Tresure/File%20manager/ARCHITECTURE.md) — Comprehensive technical architecture.
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
