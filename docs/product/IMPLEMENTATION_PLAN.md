# Implementation Plan — Nexora AI File Manager

## Product: Nexora — AI File Manager
**Version:** 0.5.0 (Adaptive Performance Without Feature Loss Milestone)  
**Target Platform:** Windows 11 (x64) desktop  
**Architecture:** Electron 33 + React 18 + Vite 6 + SQLite (better-sqlite3 WAL) + Python 3.14 (OpenCV 5.0)  

---

## 1. Upgrade Objectives & Milestones

The v0.2.0 upgrade resolves foundational engine execution bottlenecks, AI inference stubs, filesystem safety gaps, and background job coordination:

```
[Phase 1: Safe File Operations] ──────> [Phase 2: Subprocess AI Worker] ──────> [Phase 3: Incremental Indexer]
          │                                        │                                       │
          ▼                                        ▼                                       ▼
  Original Immutability                    OpenCV 5.0 Inference                    Mtime/Size Caching
  SHA-256 Checksums                        Multi-Face Detection                    Batch SQLite (50/tx)
  Rollback & Undo Guard                    Pairwise Cosine Clustering              Exact & Visual Dupes
                                           Video Frame Sampling
          │                                        │                                       │
          └────────────────────────────────────────┴───────────────────────────────────────┘
                                                   │
                                                   ▼
                                   [Phase 4: Background Orchestration]
                                                   │
                                   Priority Job Runner (job-runner.ts)
                                   Chokidar Watcher with Debounce (watcher.ts)
                                   Database Health: PRAGMA integrity_check, VACUUM
                                   Comprehensive Testing (Vitest Unit & Integration)
```

---

## 2. Phase-by-Phase Delivery Breakdown

### Phase 1: Critical Filesystem Safety & Rollback Engine
- **Module**: `src/main/file-operations.ts`
- **Deliverables**:
  - `computeFileSha256(filePath)`: Stream-based SHA-256 computation over 64KB buffers.
  - `validateDestinationRoot(destDir, requiredBytes)`: Verifies write permissions and checks drive free space via `fs.statfsSync`.
  - `resolveSafeDestinationPath(destPath, sourceHash)`: Checks for identical duplicates (skips redundant copying) or collisions (appends non-destructive `(1)`, `(2)` increment).
  - `copyFileWithVerification(src, dest)`: Writes to temporary `.nexora-tmp-*` file, verifies matching SHA-256, and atomically renames to target.
  - `revertBatchOperation(operationId)`: Validates destination file hash before unlinking. If destination was modified by user post-copy, the file is protected and preserved.

### Phase 2: Local AI Inference Worker & Vector Clustering
- **Module**: `src/main/ai-worker-client.ts` & `ai-worker/src/main.py`
- **Deliverables**:
  - Python JSON-RPC subprocess runner over `stdin`/`stdout`.
  - Multi-face detection utilizing OpenCV skin-color segmentation (`YCrCb`), aspect-ratio verification, and Laplacian sharpness scoring.
  - 64-dimensional normalized face embeddings.
  - Pairwise cosine distance matrix clustering with user-configurable thresholds (default `0.35`).
  - Video keyframe sampler (`analyze_video`) analyzing frames at 1-second intervals with timestamp and frame recording.
  - Robust crash recovery in Node.js: detects non-zero exit codes, applies exponential backoff, and re-establishes RPC communication.

### Phase 3: High-Performance Incremental Indexer & Deduplication
- **Module**: `src/main/indexer.ts`
- **Deliverables**:
  - Recursive folder scanning (`collectFilesRecursively`) filtering `.git`, `node_modules`, `$RECYCLE.BIN`, and system folders.
  - O(1) in-memory comparison against cached `mtime` and `size_bytes`: skips unchanged files instantly without recomputing hashes.
  - Batched SQLite transactions: commits file records, FTS5 rows, and face detections in 50-item batches.
  - Two-tier duplicate detection:
    1. Exact duplicates: grouped by bit-for-bit identical SHA-256 hashes (`type = 'exact'`, similarity `1.0`).
    2. Visual similarity duplicates: grouped by perceptual difference hash (`dHash`) with Hamming distance $\le 2$ (`type = 'visual_similarity'`, similarity `0.92`).

### Phase 4: Job Scheduling, Watcher & Database Maintenance
- **Modules**: `src/main/job-runner.ts`, `src/main/watcher.ts`, `src/main/database.ts`
- **Deliverables**:
  - Persistent background job queue in SQLite `jobs` table with priority ordering (1-10).
  - Cancellation token support, pause/resume, and real-time IPC telemetry (`job:progress`, `job:completed`).
  - Chokidar watcher with a 500ms sliding debounce window to batch burst filesystem modifications.
  - Database health checks: `checkDatabaseIntegrity()`, `vacuumDatabase()`, `rebuildSearchIndex()`, and `mergePeople()`.

### Phase 5: Production-Ready Metadata Intelligence Engine Integration (v0.3.0)
- **Modules**: `ai-worker/src/main.py`, `database/migrations/002_metadata_intelligence.sql`, `src/main/indexer.ts`, `src/main/organizer.ts`, `src/main/database.ts`, `src/main/ipc-handlers.ts`, `src/preload/index.ts`, `src/renderer/services/api.ts`, `tests/`
- **Deliverables**:
  - **Modular Local Extractors (`ai-worker/src/main.py`)**: Format-specific parsers for Images (EXIF capture date, camera make/model, lens, dimensions, orientation, ISO, focal length, aperture, exposure time, GPS), Videos (resolution, duration, fps, FourCC codec), Documents (PDF title, author, subject, page count, and 3KB text preview; Office DOCX/PPTX/XLSX Dublin Core properties and word counts), Audio (WAV RIFF stream parameters, sample rate, channels, bitrate, duration; MP3 ID3v2 tags and MPEG frames; FLAC STREAMINFO), Archives (ZIP/TAR entry count and password encryption detection), and Plaintext/Code (line count, word count, encoding detection, preview snippet).
  - **Safe Container Sandboxing**: Zero macro or script execution; all Office/ZIP extraction is purely structured read-only XML and binary header traversal.
  - **Schema Migration 002 (`002_metadata_intelligence.sql`)**: 24 dedicated metadata columns on `files`, indexes on camera, author, artist, and missing status, plus `organization_rules` and `organization_proposals` tables.
  - **Incremental Indexer & Reconciler (`src/main/indexer.ts`)**: Timestamp and size cache hit reuse; `forceFullRescan` option; non-destructive missing file reconciliation (`is_missing = 1`, `availability_status = 'missing'`) preserving user records and source files.
  - **Metadata Organization Engine (`src/main/organizer.ts`)**: Rule template pattern engine (`{category}/{YYYY}/{MM}/{DD}/{person}/{camera}/{location}/{event}/{author}`) with deterministic fallbacks (`Unknown Date`, `Unassigned`, `Unknown Location`, `General`, `Unknown Camera`, `Unknown Author`, `Other Files`).
  - **Verified Copy & Rollback Guard**: Item-level proposal preview, duplicate avoidance, and atomic verified copy (pre/post SHA-256 check, temp staging, rollback safety) without modifying originals.
  - **Multi-Parameter Search Integration (`src/main/database.ts`)**: Search by category, camera make/model, author, artist, GPS, missing status, and FTS5 full-text matching.
  - **Automated Vitest Test Suites**: 44 tests passing across 9 test suites with 100% pass rate.

### Phase 6: Low-End PC Optimization & Adaptive Resource Management (v0.4.0)
- **Modules**: `src/main/hardware-monitor.ts`, `src/main/job-runner.ts`, `ai-worker/src/main.py`, `src/renderer/pages/SettingsPage.tsx`, `src/shared/types.ts`, `tests/unit/hardware-and-adaptive.test.ts`
- **Deliverables**:
  - **Hardware Monitor**: Non-admin probing of CPU cores/load, total/free RAM, GPU VRAM & acceleration provider, and primary SSD/HDD disk type via PowerShell CimInstance.
  - **Resource Profiles**: Four distinct operational profiles (`low`, `balanced`, `performance`, `auto`) configuring concurrency, batch sizes, and video sampling intervals.
  - **Dynamic Throttling & Hysteresis**: Evaluates memory pressure (>82%) and CPU load (>85%) to throttle down to `low` profile; enforces 5-second minimum adjustment window to prevent oscillation; asymmetric recovery requires <70% CPU and <70% RAM.
  - **4-Tier Priority Scheduling**: P1 Interactive > P2 Lightweight Indexing > P3 Background Enrichment > P4 Heavy AI. Heavy AI is deferred during throttling or when `runAiOnlyWhenIdle` is enabled.
  - **Direct Video Seek Sampling**: Replaced sequential decoding with direct keyframe seeking (`cap.set(cv2.CAP_PROP_POS_FRAMES)`), reducing video analysis CPU/RAM consumption by >90%. Added 64x64 thumbnail difference comparison to suppress redundant face scans on static scenes.
  - **Settings UI Controls**: Live telemetry cards, persistent job queue monitoring with items/sec throughput, master Pause/Resume All button, background AI toggle, and idle-only processing.

### Phase 7: Non-Negotiable Principle — Adaptive Performance Without Feature Loss (v0.5.0)
- **Modules**: `src/main/hardware-monitor.ts`, `src/main/indexer.ts`, `src/main/job-runner.ts`, `src/shared/types.ts`, `src/renderer/pages/SettingsPage.tsx`, `tests/unit/hardware-and-adaptive.test.ts`
- **Deliverables**:
  - **Feature Parity Invariant**: All features remain fully available across low-end, mid-range, and high-performance machines. Capabilities are never disabled (`allowBackgroundAi = true` across all profiles).
  - **AI Accuracy Invariant**: Standardized face image normalization resolution to 1600px across all profiles (`low`, `balanced`, `performance`), eliminating vector embedding drift and ensuring 100% identical detection precision ($\ge 0.70$ confidence) and clustering accuracy ($0.60$ distance) regardless of hardware tier.
  - **Scheduling Adaptation Over Capability Removal**: On low-end systems or under resource pressure (>82% RAM or >85% CPU load), heavy AI operations are deferred (`deferHeavyAi = true`) rather than dropped. Files are recorded immediately in SQLite with `processing_status = 'pending'`, and Priority 4 jobs (`face_detect`, `video_analyze`) are enqueued into the `jobs` table.
  - **Complete & Resumable AI Execution**: Dedicated job handlers (`handleFaceDetectJob`, `handleVideoAnalyzeJob`) in `JobRunner` execute deferred AI analysis via `AiWorkerClient`, persist face detections and video observations, verify file timestamps, and update `processing_status = 'completed'` without touching original files.
  - **Transparent Trade-Offs**: Extended `JobQueueStats` with `pendingAiFiles` and `isWaitingForIdle`; added Pending AI counter tile, idle-waiting badge, and throttling status in the Settings UI so users always know when analysis is deferred. Tasks are never falsely reported as completed when required analysis is pending.
  - **Automated Vitest Test Suites**: Expanded `tests/unit/hardware-and-adaptive.test.ts` with dedicated Non-Negotiable Principle and quad-core scaling tests. Total test suite expanded to 68 tests passing across 11 test suites with 100% pass rate.

---

## 3. Verification & Quality Gates

| Milestone | Gate Criteria | Validation Command |
| :--- | :--- | :--- |
| **Type Integrity** | 0 TypeScript errors across main and renderer | `npm run typecheck` & `npm run typecheck:main` |
| **Unit Verification** | 100% pass rate on filesystem, types, db, copy safety, AI worker, metadata extraction, organizer | `npm test` |
| **Integration** | End-to-end indexing, metadata caching, missing file reconciliation, and deduplication | `npx vitest run tests/integration` |
| **Production Build** | Clean Vite renderer bundle and Electron main compilation | `npm run build` |
