# Privacy, Security & Data Sovereignty Specification — Nexora

## Product: Nexora — AI File Manager
**Version:** 0.3.1  
**Core Guarantee:** 100% On-Device AI Processing with Zero Cloud Telemetry  

---

## 1. Privacy Architecture: Zero-Cloud Guarantee

Nexora is designed from the ground up to respect complete user privacy and data sovereignty:

1. **Air-Gapped AI Inference & Extraction**:
   - All metadata extraction (EXIF, PDF, Office, audio, archives), facial detection, facial embeddings, vector clustering, perceptual hashing, and timeline indexing are executed entirely locally by the Python subprocess (`ai-worker/src/main.py`).
   - No biometric data, face crops, document text excerpts, GPS coordinates, hashes, or media tokens are ever transmitted across the network.
2. **Zero Remote Telemetry**:
   - Nexora contains no tracking SDKs, telemetry beacons, analytics frameworks, or automated crash reporting to remote third parties.
   - All error logs remain on the local machine in the SQLite `job_errors` table and Electron userData logs.
3. **Identity Protection & Non-Inference from Filenames**:
   - Faces detected in photos are never automatically assigned real-world names or identities.
   - Identities remain labeled as `unreviewed` until the user explicitly reviews, names, or merges them in `PeoplePage`.
   - **Strict Non-Inference**: Under no circumstance is a person's identity inferred from a filename alone (e.g. `John_Doe_graduation.jpg` never tags person `John Doe`).
   - Folder proposals require confirmed/reviewed status; unreviewed matches default safely to `Unassigned`. Multiple confirmed individuals are aggregated without bias.
4. **Metadata Privacy & Safe Parsing**:
   - Metadata extraction is strictly non-executing. Office documents (DOCX, PPTX, XLSX) and PDF files are parsed strictly as read-only ZIP/XML trees and header streams. Macros, scripts, VBA, and shell payloads are never executed.
   - Document text previews, OCR text, and technical camera metadata are stored exclusively in local SQLite tables and queried via SQLite FTS5.
   - Folder exclusions (`exclude_patterns`) allow users to omit sensitive directories from scanning.
5. **Exact Duplicate Cryptographic Integrity & Source Path Preservation**:
   - Files are never classified as duplicates based on filename, size, or timestamp alone; byte-for-byte SHA-256 verification is mandatory.
   - Distinct source paths and database records are preserved even for identical files. Duplicate candidates are never automatically deleted or overwritten without explicit user review.
6. **In-Flight Stream Modification Protection**:
   - Files undergoing cryptographic hashing or copy operations are guarded by pre/post stream stat comparisons. If a file is modified during hashing or copying, operations abort, temporary staging files are unlinked, and stale results are invalidated.

---

## 2. Desktop Security & Process Isolation

Nexora adheres strictly to the Electron Security Checklist and Windows application sandboxing best practices:

### 2.1 Multi-Process Sandboxing & Context Isolation
- **Context Isolation**: `contextIsolation: true` is strictly enforced on all `BrowserWindow` instances.
- **Node Integration**: `nodeIntegration: false` is permanently disabled in the renderer. The UI shell executes in a sandboxed Chromium environment.
- **No Direct Remote Code Execution**: Dynamic scripts (`eval()`, inline event handlers) are blocked via strict Content Security Policy (`CSP`).

### 2.2 IPC Hardening & Input Sanitization
- All IPC channels exposed via `electronAPI` validate caller arguments before executing OS actions:
  - **Path Sanitization**: Paths are checked for null bytes (`\0`) and invalid path traversal sequences (`..`).
  - **UUID / ID Validation**: Operation and Job IDs are validated using UUID regex format before executing SQL queries.
  - **External Protocol Interception**: `shell.openExternal` is restricted to authorized safe protocols (`http`, `https`). `window.open` requests are intercepted and denied by `setWindowOpenHandler`.

### 2.3 Filesystem Operation Safety
- **Copy-First Invariant**: Automatic organization tools never move or delete original media files. They always create verified copies.
- **Pre-Copy Space Validation**: `fs.statfsSync` checks destination free disk space to avoid filling up drives and causing system instability.
- **Cryptographic Verification**: Every copy operation computes and verifies SHA-256 pre-copy and post-copy checksums.
- **Modified-Copy Guard**: If a user modifies an organized file, the rollback engine refuses to delete it during undo operations, preventing catastrophic data loss.
