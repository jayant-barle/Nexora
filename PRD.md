# Product Requirements Document (PRD)

## Project: AI File Manager for Windows 11
**Document Version:** 1.0.0  
**Status:** Implemented (v0.1.0) / Active Development  
**Target Platform:** Windows 10 & Windows 11 (x64)  
**Execution Model:** Local-First, Offline, Zero-Cloud Telemetry  

---

## 1. Executive Summary & Problem Statement

### 1.1 The Problem
Standard desktop file explorers (such as Windows File Explorer) were designed decades ago for hierarchical file storage. As user storage expands into terabytes of digital photos, high-resolution video recordings, downloaded documents, and project assets, standard explorers exhibit severe limitations:
- **No Semantic or Content Intelligence**: Search is limited to filename substrings or rudimentary file properties; searching for "photos of Dad at the beach in 2022" is impossible without extensive manual folder sorting.
- **Rampant Duplication**: Users accumulate duplicate files across drives and SD card dumps, consuming gigabytes of SSD/HDD space with no safe, automated way to differentiate exact copies from burst-shot photos.
- **Privacy Trade-offs of Cloud Alternatives**: Cloud photo managers (Google Photos, Apple iCloud, OneDrive) provide intelligent tagging and face clustering, but require uploading sensitive personal media to remote servers, incurring monthly subscriptions, bandwidth consumption, and privacy risks.
- **Destructive Reorganization Hazards**: Automated third-party sorting tools often move, overwrite, or delete source files with no audit trail or rollback capability.

### 1.2 The Solution
**AI File Manager** is a local-first Windows 11 desktop application that combines standard filesystem navigation with on-device artificial intelligence. It indexes files locally in a high-speed SQLite database, executes face recognition and clustering via a local Python engine, identifies exact and perceptual duplicates, and organizes media through safe, copy-based operations with mandatory SHA-256 checksum verification and one-click rollback.

---

## 2. Target Users & Use Cases

### 2.1 Target Personas
1. **The Family Archivist**: Individuals managing decades of family photos and home videos scattered across phone backups, USB sticks, and external hard drives. Needs to locate specific relatives without cloud uploads.
2. **The Content Creator / Photographer**: Photographers and videographers capturing thousands of RAW/JPEG images and clips per session. Needs rapid deduplication, EXIF timeline browsing, and storage breakdown.
3. **The Privacy-Conscious Power User**: Users who refuse cloud scanning of their personal records and photos, requiring 100% on-device AI inference with zero network requests.

### 2.2 Key User Journeys
- **Journey 1: Indexing a Folder**: User clicks "Index Folder", selects a directory (e.g. `D:\Photos 2023`), and the app scans all files in the background, computing hashes, extracting EXIF dates/GPS, and detecting faces without freezing the UI.
- **Journey 2: Finding Photos of a Person**: User navigates to the "People" view, sees automatically clustered face thumbnails, assigns a name to an unreviewed face (e.g., "Sarah"), and clicks on Sarah to view all associated photos across all indexed drives.
- **Journey 3: Cleaning Disk Space**: User navigates to the "Duplicates" view, views identified duplicate groups, compares side-by-side previews, and chooses "Keep Best Quality" or "Move to Trash".
- **Journey 4: Timeline Browsing**: User navigates to the "Timeline" view and browses media chronologically grouped by Year, Month, or Day extracted from camera EXIF timestamps.

---

## 3. Product Goals & Non-Goals

### 3.1 Primary Goals
- **100% Local Privacy**: Zero external API calls for media analysis. All face embeddings, clustering, hashing, and metadata parsing occur on the local CPU/GPU.
- **Non-Destructive Guarantee**: Original source files in scanned directories are never moved, renamed, or modified without explicit user confirmation. Library organization uses copy-first semantics.
- **Responsive Desktop Performance**: Electron main process and React UI must never block during heavy AI analysis or multi-gigabyte disk scans. All heavy processing is delegated to background worker queues and subprocesses.
- **Windows 11 Fluent Design**: Provide a premium dark-mode interface aligned with Windows 11 aesthetics, featuring smooth transitions, glassmorphic surfaces, and legible typography.

### 3.2 Non-Goals (Out of Scope for v1)
- Cloud synchronization or remote server backups.
- Direct RAW camera file editing (non-destructive photo editing suite).
- Multi-user network collaboration over LAN.
- Mobile companion applications (iOS / Android).

---

## 4. Functional Requirements

### 4.1 Filesystem & Navigation (`FR-01`)
- **FR-01.1**: The system must detect and list all logical Windows drives (`C:`, `D:`, etc.) with volume labels, filesystem types, used space, and free space.
- **FR-01.2**: The system must provide a two-pane or breadcrumb-based directory browser capable of traversing nested Windows directories.
- **FR-01.3**: The explorer must support sorting by Name, Date Modified, Size, and Extension in ascending and descending orders.
- **FR-01.4**: Users must be able to toggle between Grid View (with thumbnails) and List View (with metadata columns).
- **FR-01.5**: The system must provide an action to "Reveal in Windows File Explorer" (`shell.showItemInFolder`) and "Open File" (`shell.openPath`).

### 4.2 Metadata & EXIF Extraction (`FR-02`)
- **FR-02.1**: The system must extract image dimensions (width, height), format, file size, and file creation/modification timestamps.
- **FR-02.2**: The system must parse EXIF `DateTimeOriginal` / `DateTime` to establish true capture timestamps.
- **FR-02.3**: The system must extract GPS latitude, longitude, and altitude from EXIF tags when present.
- **FR-02.4**: The system must generate and persist downscaled JPEG thumbnails (256x256) for quick grid rendering.

### 4.3 Facial Recognition & Clustering (`FR-03`)
- **FR-03.1**: The system must detect human faces in indexed images and store normalized bounding boxes (`x`, `y`, `width`, `height`) and confidence scores.
- **FR-03.2**: The system must extract vector embeddings for detected faces.
- **FR-03.3**: The system must cluster face embeddings using cosine distance thresholding to aggregate identical individuals.
- **FR-03.4**: The system must provide a People management interface supporting:
  - Renaming person clusters (assigning human names).
  - Review status workflow (`unreviewed` -> `reviewed` -> `confirmed`).
  - Hiding or excluding low-quality or irrelevant face clusters.
  - Deleting or merging clusters.

### 4.4 Search & Filtering (`FR-04`)
- **FR-04.1**: The system must maintain an FTS5 full-text search index covering filenames, paths, tags, and OCR text.
- **FR-04.2**: The Search view must support combined filtering by:
  - Free-text query.
  - File extension (e.g. `jpg, png, mp4`).
  - Date ranges (From / To).
  - File size range (Min / Max MB).
  - Person identity filter.
- **FR-04.3**: Search queries must return execution duration in milliseconds (`executionTimeMs`).

### 4.5 Deduplication & Reclaimable Space (`FR-05`)
- **FR-05.1**: The system must compute SHA-256 hashes to identify byte-for-byte exact file duplicates.
- **FR-05.2**: The system must compute perceptual difference hashes (`dHash`) to identify near-duplicate or burst photos.
- **FR-05.3**: The system must group duplicates and compute total wasted/reclaimable disk bytes.
- **FR-05.4**: The Duplicates view must provide side-by-side comparison of duplicate candidates.
- **FR-05.5**: The system must support resolution actions: Keep Best Quality, Keep Newest, Move to Trash, and NTFS Hardlink replacement.

### 4.6 Continuous Folder Watching (`FR-06`)
- **FR-06.1**: The system must allow users to register watched directories (`watch_roots`).
- **FR-06.2**: The watcher service must detect file additions, modifications, renames, and deletions using `chokidar`.
- **FR-06.3**: The watcher must debounce events (`watcherDebounceMs`, default 2000ms) to avoid thrashing during large file copies.
- **FR-06.4**: Users must be able to pause, resume, or remove watched folders.

### 4.7 Task Queue & Background Worker (`FR-07`)
- **FR-07.1**: Long-running operations (folder scanning, hashing, face detection, video analysis) must be queued as background jobs.
- **FR-07.2**: Jobs must track `progress`, `total`, `status` (`queued`, `running`, `paused`, `completed`, `failed`, `cancelled`), and `retry_count`.
- **FR-07.3**: The Activity view must display live job progress bars and offer pause, resume, and cancellation controls.
- **FR-07.4**: Failed jobs must log descriptive error messages to `job_errors`.

### 4.8 Safe Organization & Rollback (`FR-08`)
- **FR-08.1**: All automated file organization operations (Person-based sorting, Date-based sorting) must execute copy operations to a designated `managedLibraryPath`.
- **FR-08.2**: Each copy operation must record source path, destination path, and file size in `operation_items`.
- **FR-08.3**: When `hashVerification` is enabled, the system must verify source and destination SHA-256 hashes before marking an item as `verified`.
- **FR-08.4**: The system must maintain an audit log in `operation_history` and support one-click rollback.

---

## 5. Non-Functional Requirements (NFR)

### 5.1 Performance & Responsiveness
- **NFR-01**: Directory listings for up to 10,000 files in a single folder must render in under 300ms.
- **NFR-02**: Database searches on indexed libraries of 100,000 files must complete in under 50ms.
- **NFR-03**: The UI frame rate must maintain 60 FPS during background AI worker execution.
- **NFR-04**: SQLite must use Write-Ahead Logging (`PRAGMA journal_mode = WAL`) and a 5000ms busy timeout to prevent write-lock contention.

### 5.2 Security & Sandboxing
- **NFR-05**: Electron `BrowserWindow` must enforce `contextIsolation: true` and `nodeIntegration: false`.
- **NFR-06**: Renderer communication must only traverse approved IPC channels defined in `preload/index.ts`.
- **NFR-07**: All path arguments passed via IPC must be strictly validated against null bytes (`\0`) and path traversal exploits.
- **NFR-08**: A strict Content Security Policy (`CSP`) must prohibit execution of unapproved external scripts and object plugins.
- **NFR-09**: Window navigation must block external URLs (`will-navigate` interception and `setWindowOpenHandler` denial).

### 5.3 Reliability & Data Safety
- **NFR-10**: Crash resilience: If the Python AI worker crashes or receives a malformed file, the Electron main process must catch the failure, log the error to `job_errors`, and resume processing subsequent files.
- **NFR-11**: Database migrations must be atomic and version-tracked in `schema_version`.
- **NFR-12**: All file modifications must be strictly non-destructive; original source files must remain intact.

---

## 6. Implementation Status Matrix

| Module | Requirement | Status | Notes |
| :--- | :--- | :--- | :--- |
| **Explorer** | Logical Drive Listing | **Implemented** | Uses Windows `wmic logicaldisk` |
| **Explorer** | Directory Navigation & Breadcrumbs | **Implemented** | List and Grid views with sorting |
| **Database** | SQLite WAL Mode & Schema v1 | **Implemented** | 25 tables, versioned migration runner |
| **Database** | FTS5 Full-Text Search | **Implemented** | Covers filenames, paths, tags, OCR |
| **AI Worker** | JSON-RPC Python Subprocess | **Implemented** | Over stdin/stdout with ping/hashes/meta |
| **AI Worker** | SHA-256 & Perceptual Hashing | **Implemented** | Native hashlib + PIL 8x8 dHash |
| **AI Worker** | EXIF & GPS Metadata Extraction | **Implemented** | DateTimeOriginal, GPS coordinates |
| **AI Worker** | Face Detection & Clustering | **Implemented** | Bounding box & cosine distance clustering |
| **UI Pages** | Dashboard Page | **Implemented** | Real-time database metrics |
| **UI Pages** | File Explorer Page | **Implemented** | Grid/list view, selection, reveal |
| **UI Pages** | People Page | **Implemented** | Review, naming, hide, delete |
| **UI Pages** | Search Page | **Implemented** | Text and multi-parameter filters |
| **UI Pages** | Timeline Page | **Implemented** | Year/Month/Day grouping |
| **UI Pages** | Events Page | **Implemented** | Event & location layout |
| **UI Pages** | Duplicates Page | **Implemented** | Hash vs similarity side-by-side |
| **UI Pages** | Storage Page | **Implemented** | Drive meters & heavy file table |
| **UI Pages** | Activity Page | **Implemented** | Live job queue controls |
| **UI Pages** | History Page | **Implemented** | Operation audit log & rollback |
| **UI Pages** | Watched Folders Page | **Implemented** | Chokidar watcher manager |
| **UI Pages** | Settings Page | **Implemented** | AI thresholds, paths, diagnostics |
| **Testing** | Vitest Test Suite | **Implemented** | Filesystem safety & types invariants |

---

## 7. Acceptance Criteria

1. **Clean Installation & Build**: `npm install --ignore-scripts`, `npx electron-builder install-app-deps`, and `npm run build` execute without errors.
2. **Offline Execution**: Disconnecting network interfaces does not impair any application feature.
3. **Responsive UI**: Clicking across all 12 navigation tabs renders without visual artifacts or console exceptions.
4. **Data Integrity**: Indexing folders creates indexed records without modifying original files on disk.
5. **Deduplication Verification**: Given identical duplicate files, the system identifies identical SHA-256 hashes and offers non-destructive resolution.
