# Troubleshooting & Diagnostic Guide — Nexora

## Product: Nexora — AI File Manager
**Version:** 0.2.0  

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
