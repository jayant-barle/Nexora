# Troubleshooting & Diagnostic Guide — Nexora

**Version:** 0.9.0 (Phase 3A Hardening)  

---

## 1. Common Diagnostics & Solutions

### 1.1 `NODE_MODULE_VERSION` Mismatch Error on Native Addon (`better-sqlite3`)
- **Symptom**:
  `Error: The module '\\?\...\\better_sqlite3.node' was compiled against a different Node.js version using NODE_MODULE_VERSION 137. Expected NODE_MODULE_VERSION 130.`
- **Cause**: Electron runs a different V8/Node ABI than the system Node.js binary.
- **Resolution**:
  Rebuild the native module targeting the installed Electron version:
  ```powershell
  npx @electron/rebuild -f -w better-sqlite3
  ```

### 1.2 Python AI Worker Subprocess Fails to Start
- **Symptom**:
  Log displays: `[AI-Worker] Failed to spawn Python worker` or capabilities report `cv2: false`.
- **Cause**: Python is not in system PATH or required modules are absent.
- **Resolution**:
  1. Verify Python availability in PowerShell:
     ```powershell
     python --version
     ```
  2. Install required packages:
     ```powershell
     pip install opencv-python numpy
     ```
  3. Test JSON-RPC ping manually:
     ```powershell
     python ai-worker/src/main.py
     # Type: {"id": "1", "method": "ping"} and press Enter
     ```

### 1.3 Disk Space or Permission Error During Copy Operations
- **Symptom**:
  Operation fails with error: `Destination validation failed: Insufficient disk space` or `No write permission`.
- **Cause**: Nexora performs strict pre-flight disk capacity checks using `fs.statfsSync`.
- **Resolution**:
  Ensure the target drive has free space exceeding the total batch size plus a 10MB safety buffer, and verify the destination folder is not write-protected.

### 1.4 Database Corruption or SQLite Locking Issues
- **Symptom**:
  `database is locked` or queries fail unexpectedly.
- **Resolution**:
  1. Nexora initializes SQLite with `PRAGMA busy_timeout = 5000` and `journal_mode = WAL` to prevent deadlocks.
  2. Check database integrity using the built-in diagnostic IPC:
     - In UI: Navigate to **Settings** > **Database Maintenance** > **Check Integrity**.
     - Or run: `db:integrity` via `window.electronAPI.database.checkIntegrity()`.
  3. Rebuild search index if FTS5 queries become desynchronized:
     - Navigate to **Settings** > **Rebuild Search Index**.

### 1.5 Watcher Event Storms / High CPU Usage
- **Symptom**:
  Adding a folder with thousands of temporary files causes frequent re-indexing.
- **Resolution**:
  Nexora's `WatcherService` implements a 500ms sliding debounce window and automatically excludes `.git`, `node_modules`, and system directories. Custom exclusion patterns can be added in `WatchedFoldersPage`.

### 1.6 Resource Pressure & Dynamic Throttling
- **Symptom**:
  A warning badge appears in Settings: `⚠️ Throttled: High memory pressure (85%)` or heavy video/face indexing slows down system responsiveness.
- **Resolution**:
  1. **Automatic Self-Correction**: Nexora's `HardwareMonitor` automatically throttles concurrency down to 1 worker and defers heavy Priority 4 AI jobs (face embeddings, video keyframes) until resource pressure drops below 70%.
  2. **Manual Profile Selection**: Open **Settings** > select **Low Resource** profile (`1 CPU worker, 25-item batches, background AI deferred`).
  3. **Idle-Only AI**: In **Settings** > toggle **Run Intensive AI Only When System is Idle** on. This guarantees face and video recognition run only when CPU usage is below 30%.
  4. **Master Pause**: Click **⏸ Pause Background Work** in the Settings panel to immediately pause all active queue execution while keeping file browsing and search fully responsive.
  5. **Stranded Job Recovery**: If Nexora is closed unexpectedly during an active scan, the job runner automatically resets all stranded `running` jobs to `queued` on the next launch with zero duplicated database records.

### 1.7 AI Feature Pipeline & In-Place Execution Diagnostics
- **Symptom**:
  Clicking AI features or indexing photos does not immediately cluster faces or display neural tags.
- **Root Cause & Behavior**:
  1. **Folder Scan AI Option**: In version 0.9.1, `extractAi` defaults to enabled (`true`) when background AI is enabled. If "Enable Background AI" is disabled in Settings, AI facial extraction and video analysis jobs are deferred or filtered.
  2. **Face Clustering Trigger**: Face clustering automatically runs when unclustered faces are detected. Users can also manually click **⚡ Run Face Clustering** in the **People & Faces** page header or empty state.
  3. **In-Place Image Vision & OCR**: Selected files in **Explorer** can be classified or OCR extracted directly from the right-hand **Nexora Intelligence** panel or via right-click context menu (**⚡ AI Vision Tag** and **📄 AI Extract Text (OCR)**).
- **Diagnostics**:
  - Verify worker status: `window.electronAPI.ai.getStatus()` returns `{ ok: true, capabilities: { cv2: true, numpy: true, offline_ready: true } }`.
  - Check job queue status in **Activity & Queue** to view background AI job progress.
