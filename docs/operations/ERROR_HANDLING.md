# Error Handling, Retries & System Recovery

## Product: Nexora — AI File Manager
**Tagline:** *"Your files. Your intelligence. Your control."*  
**Platform:** Windows 11 Desktop  
**Canonical Version:** `0.1.0`

---

## 1. Multi-Layer Fault Tolerance Architecture

Nexora operates across three distinct execution environments: the Chromium Renderer UI, the Node.js Electron Main process, and the Python AI Inference subprocess. Robust error boundaries isolate failures within each layer to prevent total application crashes.

```
+--------------------------------------------------------------------------+
|                     Layer 1: React Renderer Process                      |
|  * React Error Boundaries (graceful fallback view per page)             |
|  * Non-intrusive toast notifications for transient errors                |
|  * Zustand state rollback on failed IPC calls                            |
+------------------------------------+-------------------------------------+
                                     | Structured IPC Result Envelope
+------------------------------------+-------------------------------------+
|                     Layer 2: Electron Main Process                       |
|  * Uncaught exception & unhandled rejection global traps                 |
|  * SQLite transactional rollbacks on write errors                        |
|  * Busy-timeout lock queuing (5000ms)                                    |
|  * Job error logging in SQLite (job_errors table)                        |
+------------------------------------+-------------------------------------+
                                     | JSON-RPC over stdin/stdout
+------------------------------------+-------------------------------------+
|                  Layer 3: Python AI Worker Subprocess                    |
|  * Per-action try/except blocks returning structured error payloads      |
|  * Auto-restart daemon on abnormal subprocess termination                |
|  * Fallbacks when optional imaging or ML packages are absent             |
+--------------------------------------------------------------------------+
```

---

## 2. IPC Error Serialization & Validation

All communication across the Electron IPC boundary enforces strict parameter validation and safe error serialization.

### 2.1. Parameter Validation Guards (`src/main/ipc-handlers.ts`)
Before any filesystem, database, or native command is processed, inputs are validated against strict structural rules:
- **Paths**: Must be non-empty strings, normalized, and strictly free of null bytes (`\0`).
- **Identifiers**: Must conform to standard UUID v4 or alphanumeric patterns to prevent injection attacks.
- **Enumerations & Booleans**: Strict type coercion and runtime checks.

### 2.2. Error Masking & Production Safety
- Internal filesystem stack traces and database paths are never leaked raw to the user interface.
- Errors thrown in the main process are caught and serialized into user-friendly diagnostic messages with unique error codes.

---

## 3. Database Fault Tolerance & Transaction Management

Nexora's embedded database engine (`better-sqlite3`) is configured for maximum data integrity:

### 3.1. Write-Ahead Logging (WAL) & Lock Contention
- **WAL Mode (`PRAGMA journal_mode = WAL;`)**: Permits concurrent reading threads while background writers append changes, virtually eliminating read locks.
- **Busy Timeout (`PRAGMA busy_timeout = 5000;`)**: If a write lock is temporarily held, incoming queries queue for up to 5 seconds before returning `SQLITE_BUSY`.

### 3.2. Atomic Transactions & Rollbacks
Multi-row updates—such as indexing a batch of files, registering face clusters, or executing duplicate resolutions—are wrapped inside explicit database transactions:
```typescript
const executeBatch = database.transaction((items) => {
  for (const item of items) {
    insertStmt.run(item);
  }
});
```
If an exception occurs at any point during the batch, the transaction automatically rolls back, leaving the database in a consistent state without orphaned rows.

---

## 4. Background Job Recovery & Error Journaling

Long-running operations (indexing, face clustering, hashing, copying) are tracked inside the `jobs` and `job_errors` tables (`database/migrations/001_initial.sql`).

### 4.1. Error Journaling Schema
```sql
CREATE TABLE job_errors (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    file_id TEXT,
    error_type TEXT NOT NULL,
    error_message TEXT NOT NULL,
    stack_trace TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 4.2. Retry Logic & Categorization
When an error occurs during job execution, it is categorized:

| Error Category | Example Cause | Strategy | Max Retries |
| :--- | :--- | :--- | :--- |
| **`transient_io`** | File temporarily locked by antivirus scanner | Exponential backoff (500ms, 1500ms, 4500ms) | 3 |
| **`file_not_found`** | File moved or deleted prior to processing | Skip file, log error, continue batch | 0 |
| **`permission_denied`** | Read access restricted on Windows system directory | Skip file, record warning, continue batch | 0 |
| **`corrupt_media`** | Truncated JPEG or invalid EXIF header | Skip metadata extraction, compute SHA-256 only | 0 |
| **`worker_crash`** | Subprocess killed due to memory limit | Restart Python worker, re-queue batch | 2 |

---

## 5. Subprocess Crash Recovery

If the Python worker subprocess crashes or is killed by the OS:
1. Electron captures the `exit` or `error` event from the spawned child process.
2. The active job item is marked as `failed` in `job_errors`.
3. Electron initiates an automatic respawn with exponential backoff.
4. If the worker fails more than 3 consecutive times within 60 seconds, the worker queue is paused, and an alert is dispatched to the UI's **Activity Page** (`ActivityPage.tsx`) notifying the user of the failure and providing a one-click manual restart button.

---

## 6. Frontend UI Error Boundaries

In the React renderer, fatal rendering exceptions in individual components are captured by top-level React Error Boundaries:
- A crash in a complex visualization (such as `TimelinePage` or `PeoplePage`) renders a localized fallback card with a **"Reload View"** button rather than white-screening the entire desktop window.
- The user can continue navigating other pages (e.g., `ExplorerPage`, `SettingsPage`) uninterrupted.
