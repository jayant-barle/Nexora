# Quality Assurance & Automated Test Plan — Nexora

## Product: Nexora — AI File Manager
**Version:** 0.9.0 (Phase 3A Hardening)  
**Test Framework:** Vitest 2.1.8+  
**Execution Environment:** Node.js 22.x / Electron 33.2.1 / Python 3.12+  

---

## 1. Test Architecture & Principles

Nexora adheres to strict quality guidelines to protect user data and ensure consistent on-device operation:
1. **Source Immutability Principle**: Tests must verify that source files are never altered, deleted, or truncated during scanning, metadata extraction, copying, or deduplication.
2. **Isolated Test Fixtures**: All tests utilize synthetic, consented fixtures in dynamic temporary directories (`os.tmpdir()`). Tests NEVER access or alter the user's personal media libraries.
3. **No Network Dependencies**: Tests must execute in 100% offline environments without cloud mocks or telemetry endpoints.
4. **Deterministic Reproducibility**: Cryptographic hashes, vector clustering distances, and deduplication logic must produce identical results across successive runs.
5. **Adaptive Performance Without Feature Loss**: Tests must verify that lower-end profiles or throttled execution states never reduce neural model resolution, lower matching thresholds, or skip files. Every eligible file receives complete analysis via resumable deferred jobs.
6. **Least Privilege & Security Boundaries**: All filesystem inputs are sanitized against directory traversal attacks (`..`), Windows forbidden characters, and null bytes. WebContents navigation and webviews are strictly blocked.

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
| `tests/unit/offline-models.test.ts` | Local AI Models Integrity | 7 | Offline manifest loading, SHA-256 verification, OpenCV SFace/YuNet initialization, INT8 quantization checks, zero network access |
| `tests/unit/phase2a-scanner-dedup.test.ts` | Phase 2A Filesystem & Dedup | 17 | Incremental scanning, cache hit/miss, exact SHA-256 duplicate grouping, corrupt file resilience, FTS5 search index sync, cancellation and recovery |
| `tests/unit/phase2b-organization-ai.test.ts` | Phase 2B Organization & Biometrics | 14 | Safe organization proposals, copy verification, collision auto-increment, crash recovery, scanner exclusion, confirmed person gating, face separation |
| `tests/unit/phase3a-security-hardening.test.ts` | Phase 3A Security & Hardening | 11 | Path traversal prevention, null byte rejection, exact deduplication edge cases (0-byte exclusion, missing file exclusion), Unicode & emojis, statfs native drives, original file immutability |
| **Total** | | **124** | **100% Passing across all 16 test suites** |

---

## 3. Test Execution Commands

```bash
# Run all unit and integration test suites
npm test

# Run tests in watch mode during development
npm run test:watch

# Run TypeScript typecheck
npm run typecheck

# Run ESLint validation
npm run lint

# Run production build
npm run build
```
