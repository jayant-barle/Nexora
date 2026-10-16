# Implementation Plan — Nexora AI File Manager

## Product: Nexora — AI File Manager
**Version:** 0.3.0 (Metadata Intelligence Milestone)  
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

---

## 3. Verification & Quality Gates

| Milestone | Gate Criteria | Validation Command |
| :--- | :--- | :--- |
| **Type Integrity** | 0 TypeScript errors across main and renderer | `npm run typecheck` & `npm run typecheck:main` |
| **Unit Verification** | 100% pass rate on filesystem, types, db, copy safety, AI worker, metadata extraction, organizer | `npm test` |
| **Integration** | End-to-end indexing, metadata caching, missing file reconciliation, and deduplication | `npx vitest run tests/integration` |
| **Production Build** | Clean Vite renderer bundle and Electron main compilation | `npm run build` |
