# Quality Assurance & Automated Test Plan — Nexora

## Product: Nexora — AI File Manager
**Version:** 0.5.0  
**Test Framework:** Vitest 2.1.9  
**Execution Environment:** Node.js 24.x + Electron 33.2.1 / Python 3.14.7  

---

## 1. Test Architecture & Principles

Nexora adheres to strict quality guidelines to protect user data and ensure consistent on-device operation:
1. **Source Immutability Principle**: Tests must verify that source files are never altered, deleted, or truncated during scanning, metadata extraction, copying, or deduplication.
2. **Isolated Test Fixtures**: All tests utilize synthetic, consented fixtures in dynamic temporary directories (`os.tmpdir()`). Tests NEVER access or alter the user's personal media libraries.
3. **No Network Dependencies**: Tests must execute in 100% offline environments without cloud mocks or telemetry endpoints.
4. **Deterministic Reproducibility**: Cryptographic hashes, vector clustering distances, and deduplication logic must produce identical results across successive runs.
5. **Adaptive Performance Without Feature Loss**: Tests must verify that lower-end profiles or throttled execution states never reduce neural model resolution, lower matching thresholds, or skip files. Every eligible file receives complete analysis via resumable deferred jobs.

---

## 2. Test Suites Summary

| Test Suite File | Scope | Test Count | Key Invariants Verified |
| :--- | :--- | :--- | :--- |
| `tests/unit/filesystem.test.ts` | Drive detection & statfs | 4 | Real-time drive letter parsing, capacity, free space, 0ms latency |
| `tests/unit/types.test.ts` | Type definitions & schema | 2 | Contract validation for `FileRecord`, `Job`, `Person`, `Settings` |
| `tests/unit/toast.test.ts` | Desktop In-App Notifications | 4 | Auto-generated ID, 6s error duration, manual dismissal, timer auto-dismissal |
| `tests/unit/database.test.ts` | SQLite schema & WAL | 9 | WAL mode, foreign keys, `integrity_check`, VACUUM, priority jobs, merge, copy ops history, candidate duplicates, full path resolution |
| `tests/unit/file-operations.test.ts` | Safe copy & rollback | 7 | SHA-256 integrity, source immutability, collisions, rollback, modified-file guard |
| `tests/unit/ai-pipeline.test.ts` | Python JSON-RPC worker | 5 | Ping capabilities, OpenCV clustering, strict distance thresholds, SHA-256 |
| `tests/integration/indexer-pipeline.test.ts` | End-to-end indexer | 3 | Incremental scanning, cached mtime hit, exact vs visual duplicate grouping |
| `tests/unit/metadata-extraction.test.ts` | Metadata Intelligence Engine | 8 | PDF, Office DOCX, audio WAV, ZIP archives, plaintext, corrupt/encrypted detection, zero macro execution |
| `tests/unit/organizer.test.ts` | Organization & Proposal Engine | 6 | Pattern resolution, deterministic fallbacks, collision renaming, duplicate avoidance, verified copy |
| `tests/integration/metadata-intelligence.test.ts` | End-to-end metadata & search | 3 | Incremental cache hit reuse, force rescan, non-destructive missing file reconciliation, rich metadata search |
| `tests/unit/mandatory-rules.test.ts` | Filename, Duplicate & Person Rules | 7 | Distinct canonical paths, SHA-256 duplicate verification, non-inference of persons, multi-person grouping, in-flight modification detection |
| `tests/unit/hardware-and-adaptive.test.ts` | Hardware & Adaptive Resource Tuning | 17 | Non-admin hardware detection, low/balanced/performance profiles, quad-core scaling, memory/CPU dynamic throttling, hysteresis dampening, queue pause/resume, crash recovery, 1600px AI accuracy preservation, scheduling adaptivity, transparent pending tracking, completeness guarantee |
| **Total** | | **75** | **100% Passing** |

---

## 3. Detailed Invariant Specifications

### 3.1 Source File Integrity & Modified Copy Protection
- **Test File**: `tests/unit/file-operations.test.ts`
- **Scenarios**:
  - `guarantees source file immutability during copy operation`: Confirms that copying generates an identical verified replica while preserving the source file with matching bytes.
  - `protects modified managed copies from deletion during rollback`: Simulates a user modifying a copied photo in an external editor. Rollback detects the hash mismatch and refuses to unlink the modified copy, recording it in `protectedFiles`.

### 3.2 AI Vector Clustering & False-Positive Separation
- **Test File**: `tests/unit/ai-pipeline.test.ts`
- **Scenarios**:
  - `clusters similar face embeddings into the same cluster`: Verifies that embeddings with cosine distance $< 0.2$ are assigned identical cluster IDs.
  - `separates distant face embeddings when threshold is strict`: Confirms that orthogonal or distant face vectors ($> 0.3$) remain in separate clusters, preventing improper identity mergers.

### 3.3 Incremental Scan Caching & Duplicate Grouping
- **Test File**: `tests/integration/indexer-pipeline.test.ts`
- **Scenarios**:
  - `performs incremental scan, indexing new files on first pass and skipping on second pass`: Validates that on second pass, 100% of unchanged files hit the `reusedCached` branch without triggering unnecessary AI extraction.
  - `recalculates exact duplicates and separates canonical original from duplicates`: Verifies that files sharing identical SHA-256 are grouped as `exact` with one designated original (`is_original = 1`) and remaining marked duplicates (`is_original = 0`).

### 3.4 Filename, Duplicate Detection & Person Identification Invariants
- **Test File**: `tests/unit/mandatory-rules.test.ts`
- **Scenarios**:
  - `treats identical filenames with different contents as distinct non-duplicates`: Confirms that two files with identical filenames (`document.pdf`) in different directories with different content hashes remain separate, are not marked as duplicates, and collision resolution safely appends numbered suffixes (`document (1).pdf`) without overwriting.
  - `detects different filenames with identical content as exact duplicates without deleting records`: Confirms that files with different names but identical SHA-256 hashes are grouped into `exact` duplicate groups with status `pending`, maintaining separate records, source paths, and designation of canonical original without auto-deletion.
  - `associates files showing different confirmed people with their respective identities`: Confirms that files associated with confirmed persons ("Alice", "Bob") propose correct destination folders (`People/Alice/`, `People/Bob/`).
  - `supports multiple confirmed people in a single file by aggregating names`: Confirms that when multiple confirmed people appear in an image, the organization engine aggregates identities into multi-person paths (`Family/Alice & Bob/`).
  - `keeps uncertain/unreviewed matches unassigned and never infers identity from filenames alone`: Confirms that unreviewed face detections resolve strictly to `'Unassigned'` with warnings, and filenames containing names (e.g. `Alice_at_the_beach.jpg`) never infer person identity without verified face recognition.
  - `resolves explicit user-defined filename tokens and safe fallback for ambiguous tokens`: Validates `{basename}`, `{ext}`, `{filename}` pattern tokens and fallback to `'General'` with warning when encountering ambiguous tokens.
  - `detects file modifications during hashing or copying and prevents corrupted state`: Confirms that mutating a source file while hashing or copying triggers in-flight modification detection, deletes staging temporary files, and returns an error without corrupting target directories.

### 3.5 Adaptive Performance Without Feature Loss
- **Test File**: `tests/unit/hardware-and-adaptive.test.ts`
- **Scenarios**:
  - `preserves 1600px AI model input resolution across all profiles (no accuracy degradation)`: Verifies that Low, Balanced, and Performance profiles maintain strictly identical 1600px face detection resolution, preventing embedding distortion or false cluster merging.
  - `adapts scheduling via deferral rather than skipping or disabling features`: Confirms that low-end hardware runs 1 worker and defers heavy AI, while mid-range and high-performance systems run 2 to 4 workers without throttling. Capabilities are never disabled (`allowBackgroundAi = true` everywhere).
  - `tracks pending AI processing transparently without false completion`: Confirms that deferred files are counted as `pendingAiFiles` and files are recorded with `processing_status = 'pending'`, never reporting completion while work remains outstanding.
  - `never reports a task as completed when required processing remains unfinished`: Confirms that unanalyzed files retain `pending` status until their Priority 4 AI job executes to completion.

---

## 4. Test Execution Commands

```bash
# Run all unit and integration test suites
npm test

# Run tests in watch mode during development
npm run test:watch

# Run main process TypeScript validation
npm run typecheck:main

# Run renderer process TypeScript validation
npm run typecheck
```
