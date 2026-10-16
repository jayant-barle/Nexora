# API Specification & IPC Reference

## Product: Nexora — AI File Manager
**Tagline:** *"Your files. Your intelligence. Your control."*  
**Version:** 1.0.0  
**Transport Layers:**
1. **Preload Context Bridge (`window.electronAPI`)**: Type-safe asynchronous interface between Chromium Renderer and Electron Main.
2. **Electron IPC Channels**: Inter-process communication (`ipcMain.handle` / `ipcRenderer.invoke`).
3. **Python AI Worker JSON-RPC**: Subprocess communication over standard input/output (`stdin` / `stdout`).

---

## 1. Preload Context Bridge (`window.electronAPI`)

Exposed via Electron's `contextBridge` in [src/preload/index.ts](file:///e:/Code%20Tresure/File%20manager/src/preload/index.ts) and consumed by the React UI via [src/renderer/services/api.ts](file:///e:/Code%20Tresure/File%20manager/src/renderer/services/api.ts).

### 1.1 Filesystem Module (`api().fs`)
#### `fs.listDrives(): Promise<DriveInfo[]>`
Enumerates all logical Windows drives.
- **Returns**: Array of drive objects:
  ```typescript
  interface DriveInfo {
    letter: string;      // e.g. "C:"
    label: string;       // e.g. "Windows SSD"
    type: string;        // e.g. "Local Disk"
    totalSize: number;   // Total bytes
    freeSpace: number;   // Free bytes
    usedSpace: number;   // Used bytes
  }
  ```

#### `fs.listDirectory(dirPath: string, options?: Record<string, unknown>): Promise<DirectoryListResult>`
Reads the contents of a Windows folder.
- **Parameters**:
  - `dirPath`: Validated absolute Windows path (e.g. `C:\Users\Name\Pictures`).
  - `options.sortBy`: `'name' | 'modified' | 'size' | 'extension'`.
  - `options.sortOrder`: `'asc' | 'desc'`.
- **Returns**: `DirectoryListResult` containing `entries: DirectoryEntry[]` and `totalCount: number`.

#### `fs.getFileInfo(filePath: string): Promise<DirectoryEntry | null>`
Retrieves filesystem attributes for a single file.

#### `fs.openFile(filePath: string): Promise<string>`
Opens the file using the default Windows application handler (`shell.openPath`).

#### `fs.revealInExplorer(filePath: string): Promise<boolean>`
Highlights the target file inside native Windows File Explorer (`shell.showItemInFolder`).

---

### 1.2 Database & Telemetry Module (`api().db`)
#### `db.getStats(): Promise<DashboardStats>`
Retrieves aggregate KPIs from the SQLite database.
- **Returns**:
  ```typescript
  interface DashboardStats {
    totalFiles: number;
    totalImages: number;
    totalVideos: number;
    totalPeople: number;
    reviewedPeople: number;
    unreviewedPeople: number;
    duplicateGroups: number;
    activeJobs: number;
    pendingJobs: number;
    failedJobs: number;
    totalIndexedSize: number;
    recentActivity: ActivityEntry[];
    watchedFolders: number;
  }
  ```

---

### 1.3 Search Module (`api().search`)
#### `search.query(searchQuery: SearchQuery): Promise<SearchResult>`
Executes multi-parameter full-text and metadata search.
- **Parameters**:
  ```typescript
  interface SearchQuery {
    text?: string;
    filename?: string;
    extension?: string[];
    dateFrom?: string;      // ISO string
    dateTo?: string;        // ISO string
    sizeMin?: number;       // Min bytes
    sizeMax?: number;       // Max bytes
    personId?: string;      // Filter by detected person
    tags?: string[];
    limit?: number;         // Default 100
    offset?: number;
  }
  ```
- **Returns**:
  ```typescript
  interface SearchResult {
    files: FileRecord[];
    totalCount: number;
    query: SearchQuery;
    executionTimeMs: number;
  }
  ```

---

### 1.4 Background Jobs Module (`api().jobs`)
#### `jobs.list(status?: string): Promise<Job[]>`
Fetches worker queue records, optionally filtered by status (`'queued' | 'running' | 'paused' | 'completed' | 'failed'`).

#### `jobs.create(type: string, targetPath?: string, targetId?: string, config?: Record<string, unknown>): Promise<Job>`
Queues a new background task.
- **Supported Job Types**:
  - `folder_scan`: Recursive directory traversal and file registration.
  - `hash_compute`: SHA-256 and perceptual difference hash computation.
  - `face_detect`: Neural face bounding box extraction.
  - `face_cluster`: Pairwise face embedding clustering.
  - `reconciliation`: Verifies indexed records against disk reality.

#### `jobs.pause(jobId: string): Promise<boolean>`
Pauses an active worker task.

#### `jobs.resume(jobId: string): Promise<boolean>`
Resumes a paused worker task.

#### `jobs.cancel(jobId: string): Promise<boolean>`
Cancels and removes a pending or running task.

---

### 1.5 People & Faces Module (`api().people`)
#### `people.list(includeHidden?: boolean): Promise<Person[]>`
Retrieves all recognized face groups with associated file counts.

#### `people.update(personId: string, updates: Record<string, unknown>): Promise<boolean>`
Updates person attributes:
- `name`: String name (e.g. "Alice").
- `review_status`: `'unreviewed' | 'reviewed' | 'confirmed'`.
- `is_hidden`: `boolean`.
- `is_excluded`: `boolean`.

#### `people.delete(personId: string): Promise<boolean>`
Deletes a person cluster and cascades associations.

---

### 1.6 Directory Watcher Module (`api().watcher`)
#### `watcher.list(): Promise<WatchRoot[]>`
Lists all registered directory watchers.

#### `watcher.add(pathStr: string, label: string): Promise<WatchRoot>`
Registers a new directory to monitor via `chokidar`.

#### `watcher.remove(watchId: string): Promise<boolean>`
Removes a watched directory from active monitoring.

#### `watcher.toggle(watchId: string, active: boolean): Promise<boolean>`
Pauses or resumes live event handling for a watched directory.

---

### 1.7 Deduplication Module (`api().duplicates`)
#### `duplicates.list(): Promise<DuplicateGroup[]>`
Returns all identified duplicate sets categorized as `'exact'` (SHA-256) or `'similar'` (perceptual dHash).

---

### 1.8 Dialog & Application Module (`api().dialog`, `api().app`)
#### `dialog.openFolder(): Promise<string | null>`
Invokes native Windows folder picker dialog (`dialog.showOpenDialog`).

#### `dialog.openFile(filters?: Array<{ name: string; extensions: string[] }>): Promise<string[] | null>`
Invokes native Windows file picker dialog.

#### `app.getVersion(): Promise<string>`
Returns application version string from `package.json`.

#### `app.getPaths(): Promise<Record<string, string>>`
Returns standard OS paths (`userData`, `appData`, `temp`, `home`, `documents`).

---

## 2. Event Channels (Main to Renderer)

The renderer registers reactive listeners via `api().on(channel, callback)`:

| Channel | Payload | Description |
| :--- | :--- | :--- |
| `job:progress` | `{ jobId: string, progress: number, total: number }` | Emitted as worker jobs increment progress |
| `job:completed`| `{ jobId: string }` | Emitted when a worker job completes successfully |
| `job:error` | `{ jobId: string, error: string }` | Emitted if a worker job encounters an error |
| `watcher:change`| `{ path: string, event: 'add' \| 'change' \| 'unlink' }` | Emitted when a watched file changes on disk |

---

## 3. Python AI Worker JSON-RPC Protocol

The Python AI worker ([ai-worker/src/main.py](file:///e:/Code%20Tresure/File%20manager/ai-worker/src/main.py)) operates as a persistent child process communicating via line-delimited JSON over standard I/O.

### 3.1 Request & Response Format
**Request Schema**:
```json
{
  "id": "req-101",
  "action": "<action_name>",
  "params": {}
}
```

**Success Response Schema**:
```json
{
  "id": "req-101",
  "status": "ok",
  "result": {}
}
```

**Error Response Schema**:
```json
{
  "id": "req-101",
  "status": "error",
  "message": "Descriptive error message",
  "traceback": "Python traceback string"
}
```

---

### 3.2 Supported Actions

#### `ping`
Health check and capability detection.
- **Params**: `{}`
- **Response**:
  ```json
  {
    "id": 1,
    "status": "ok",
    "result": { "pong": true, "pil": true, "numpy": true }
  }
  ```

#### `compute_hashes`
Calculates cryptographic and perceptual difference hashes.
- **Params**: `{"file_path": "C:\\Photos\\img01.jpg"}`
- **Response**:
  ```json
  {
    "id": 2,
    "status": "ok",
    "result": {
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "md5": "d41d8cd98f00b204e9800998ecf8427e",
      "size_bytes": 1048576,
      "phash": "3f8e1a0b5c9d2e4f"
    }
  }
  ```

#### `extract_metadata`
Extracts EXIF dates, camera info, pixel dimensions, and GPS coordinates.
- **Params**: `{"file_path": "C:\\Photos\\img01.jpg"}`
- **Response**:
  ```json
  {
    "id": 3,
    "status": "ok",
    "result": {
      "width": 4032,
      "height": 3024,
      "capture_time": "2023-08-15T14:32:01",
      "has_gps": true,
      "latitude": 37.7749,
      "longitude": -122.4194,
      "camera_make": "Sony",
      "camera_model": "ILCE-7M4"
    }
  }
  ```

#### `generate_thumbnail`
Generates downscaled JPEG thumbnail.
- **Params**:
  ```json
  {
    "file_path": "C:\\Photos\\img01.jpg",
    "output_path": "C:\\Users\\Name\\AppData\\Roaming\\nexora\\thumbs\\thumb1.jpg",
    "max_size": 256
  }
  ```
- **Response**:
  ```json
  {
    "id": 4,
    "status": "ok",
    "result": { "success": true, "thumbnail_path": "C:\\...\\thumb1.jpg" }
  }
  ```

#### `cluster_faces`
Performs pairwise cosine distance clustering on embedding vectors.
- **Params**:
  ```json
  {
    "embeddings": [
      [0.012, 0.453, -0.211, ...],
      [0.015, 0.448, -0.209, ...]
    ],
    "threshold": 0.6
  }
  ```
- **Response**:
  ```json
  {
    "id": 5,
    "status": "ok",
    "result": [0, 0]
  }
  ```
  *(Returns an array of cluster integer IDs matching the input embeddings length).*
