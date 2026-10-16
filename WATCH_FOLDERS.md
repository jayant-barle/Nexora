# Watched Folders & Real-Time Monitoring Specifications

## Product: Nexora — AI File Manager
**Tagline:** *"Your files. Your intelligence. Your control."*  
**Platform:** Windows 11 Desktop  
**Canonical Version:** `0.1.0`

---

## 1. Real-Time Filesystem Monitoring

Nexora provides continuous, automated monitoring of user-selected directories to ensure the local database, search index, and AI intelligence layers remain synchronized with on-disk changes.

```
+--------------------------------------------------------------------------+
|                        Windows Filesystem Events                         |
|                    (ReadDirectoryChangesW / NTFS)                        |
+------------------------------------+-------------------------------------+
                                     |
                                     v
+--------------------------------------------------------------------------+
|                  Chokidar File Watcher (Main Process)                    |
|                                                                          |
|   * Debounce Buffer (500ms sliding window)                               |
|   * Filter Ignore Patterns (.git, node_modules, temp files)              |
+------------------------------------+-------------------------------------+
                                     |
            +------------------------+------------------------+
            |                        |                        |
            v                        v                        v
     [File Added]             [File Modified]          [File Unlinked]
            |                        |                        |
            v                        v                        v
    +---------------+        +---------------+        +---------------+
    | Queue Index   |        | Invalidate    |        | Mark Missing  |
    | Job in SQLite |        | Hash & Re-index|        | in Database   |
    +---------------+        +---------------+        +---------------+
```

---

## 2. Watch Roots Configuration (`watch_roots`)

Watched directories are persisted in the `watch_roots` table (`database/migrations/001_initial.sql`):

```sql
CREATE TABLE watch_roots (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    recursive INTEGER NOT NULL DEFAULT 1,
    scan_status TEXT NOT NULL DEFAULT 'idle',
    last_scan_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Management via UI (`WatchedFoldersPage.tsx`)
- **Add Watch Root**: Native folder picker dialog via `dialog.showOpenDialog({ properties: ['openDirectory'] })`.
- **Toggle Active State**: Instantly enables or disables watcher without deleting historical indexing records.
- **Remove Watch Root**: Detaches filesystem listener and optionally cleans up associated records.

---

## 3. Event Processing & Debouncing

When files are rapidly created or modified in bulk (for instance, extracting an archive or importing a 1,000-photo camera SD card), unthrottled event handling can exhaust system resources.

### 3.1. Debounce Sliding Window
- Filesystem events are queued in a sliding debounce window (default: `500ms`).
- Multiple consecutive `change` events on the same file path (common during file downloads or slow disk writes) are coalesced into a single re-indexing job.
- File write completion is verified by checking that file size and modification timestamps stabilize across two polling intervals.

### 3.2. Ignore Patterns & Exclusions
To maintain low CPU and memory footprints, the watcher automatically excludes transient, system, and development directories:
- `.git/`, `.svn/`, `.hg/`
- `node_modules/`, `venv/`, `.venv/`, `__pycache__/`
- `Thumbs.db`, `desktop.ini`, `ehthumbs.db`
- `*.tmp`, `*.crdownload`, `*.part`
- Hidden system files and temporary swap files (`~$*`)

---

## 4. Recovery from Missed Events (Offline Reconciliation)

If a user adds, modifies, or deletes files inside a watched folder while Nexora is not running, the application executes a fast **Startup Reconciliation Protocol**:

```
[Nexora Startup]
     │
     ├── 1. Read all active roots from `watch_roots` WHERE active = 1
     ├── 2. Query existing file list from database: SELECT relative_path, size_bytes, modified_at
     ├── 3. Perform lightweight shallow directory scan on filesystem
     ├── 4. Reconcile Delta:
     │       ├── File on disk NOT in database   --> Queue 'index_file' job
     │       ├── File in database NOT on disk   --> Mark 'missing' (do not delete record immediately)
     │       └── File on disk has newer mtime   --> Queue 'update_metadata' job
     └── 5. Update watch_roots.last_scan_at with current timestamp
```

### Missing File Grace Period
When an indexed file is not found on disk, Nexora marks it as `is_missing = 1` rather than immediately purging the database row. This protects against:
- Temporarily unmounted USB flash drives or external backup drives.
- Temporary network share disconnects.
- Antivirus software transiently quarantining or locking a file during inspection.

If the drive or file reappears, `is_missing` is cleared immediately with all associated facial tags and metadata preserved.
