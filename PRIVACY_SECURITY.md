# Privacy Architecture & Security Policy

## Product: Nexora — AI File Manager
**Tagline:** *"Your files. Your intelligence. Your control."*  
**Platform:** Windows 11 Desktop  
**Canonical Version:** `0.1.0`

---

## 1. The Zero-Cloud Privacy Guarantee

Nexora is designed from first principles as an air-gapped, privacy-first desktop application. In an era where desktop software routinely ships user files and telemetry to third-party cloud infrastructure, Nexora enforces an uncompromising standard:

1. **Zero Cloud Uploads**: User files, thumbnails, facial embeddings, and metadata never leave the local Windows PC.
2. **Zero Telemetry**: Nexora contains no tracking beacons, usage analytics, error-reporting pings, or diagnostic telemetry.
3. **Offline First & Offline Always**: All core features—face recognition, perceptual deduplication, smart search, and timeline visualization—function identically whether the PC is online or completely disconnected from the internet.
4. **Local Biometric Storage**: Face vectors and cluster associations are stored entirely inside the user's local SQLite database and are never shared or exported without explicit user command.

---

## 2. Sensitive Data Classification & Protection

| Data Type | Source | Sensitivity | Storage Location | Protection Mechanism |
| :--- | :--- | :--- | :--- | :--- |
| **Facial Embeddings** | Python AI Worker | **High (Biometric)** | SQLite `face_detections.embedding` | Stored locally in BLOB/JSON; never uploaded; deleted on cluster removal. |
| **GPS Coordinates** | Image EXIF Headers | **High (Location)** | SQLite `files.latitude`, `files.longitude` | Stored in local DB; hidden when exporting or sharing unless toggled on. |
| **File Path Names** | Windows Filesystem | **Medium (Private Info)** | SQLite `files.relative_path` | Kept in local `%APPDATA%` database only. |
| **File Hashes** | SHA-256 / MD5 / dHash | **Low** | SQLite `files.sha256`, `files.phash` | Non-reversible cryptographic representations. |
| **Thumbnails** | Image Downscaling | **Medium** | `%APPDATA%\nexora\thumbnails\` | Stored in isolated application cache with randomized UUIDs. |

---

## 3. Electron Hardened Desktop Security

Nexora adheres strictly to the **Electron Security Best Practices Guidelines**:

```
+--------------------------------------------------------------------------+
|                     Electron Renderer Process (Chromium)                 |
|                                                                          |
|   * contextIsolation: true                                               |
|   * nodeIntegration: false                                               |
|   * sandbox: true                                                        |
|   * Content Security Policy (CSP) enforced                               |
|                                                                          |
|                     window.electronAPI (contextBridge)                   |
+------------------------------------+-------------------------------------+
                                     | Type-safe IPC Handlers
+------------------------------------+-------------------------------------+
|                      Electron Main Process (Node.js)                     |
|                                                                          |
|   * Input validation (rejection of null bytes, type coercion checks)     |
|   * Shell lockdown (external URL interception via shell.openExternal)    |
|   * Window open lockdown (setWindowOpenHandler denial)                   |
|   * Parameterized SQLite queries (100% prepared statements)              |
+--------------------------------------------------------------------------+
```

### 3.1. Context Isolation & Node Integration
- `contextIsolation` is explicitly set to `true` in `src/main/index.ts`. Renderer scripts cannot access Electron internals, Node.js runtime, or the global `process` object.
- `nodeIntegration` is explicitly set to `false`. Arbitrary script injection cannot invoke Node APIs like `require('child_process')` or `require('fs')`.

### 3.2. Content Security Policy (CSP)
Every HTTP and file response is bound to a strict Content Security Policy header:
```http
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: file:; connect-src 'self';
```
- Restricts script execution strictly to local application bundles (`src/renderer/index.html`).
- Forbids loading remote scripts, CDNs, external styles, or unauthorized WebSockets.

### 3.3. Navigation & Window Creation Lockdown
- **Navigation Interception (`will-navigate`)**:
  If any link attempts navigation away from `index.html`, the default behavior is cancelled immediately. Legitimate external links (such as project documentation or GitHub links) are routed safely through the operating system's default browser via `shell.openExternal`.
- **Window Open Prevention (`setWindowOpenHandler`)**:
  Window creation via `window.open()` or `target="_blank"` is intercepted and blocked (`action: 'deny'`).

### 3.4. Input Validation & IPC Parameter Sanitization
All IPC handlers registered in `src/main/ipc-handlers.ts` pass through strict runtime validation guards:
```typescript
function validatePath(inputPath: unknown): string {
  if (typeof inputPath !== 'string' || inputPath.length === 0) {
    throw new Error('Invalid path: must be a non-empty string');
  }
  const normalized = path.normalize(inputPath);
  if (normalized.includes('\0')) {
    throw new Error('Invalid path: contains null bytes');
  }
  return normalized;
}
```
- **Null-Byte Rejection**: Prevents null-byte injection attacks (`\0`) which can truncate path strings in low-level C runtime filesystem calls.
- **Path Traversal Guards**: Rejects relative directory traversal escaping configured root boundaries.
- **UUID & ID Validation**: Verifies IDs against standard UUID v4 / alphanumeric regex masks.

---

## 4. Threat Modeling & Defenses

### 4.1. SQL Injection
- **Threat**: Malicious filenames containing SQL control characters (e.g., `photo'; DROP TABLE files;--.jpg`).
- **Defense**: 100% of SQLite database operations in `src/main/database.ts` utilize parameterized prepared statements (`better-sqlite3.prepare(...).run(...)`). No dynamically concatenated SQL strings are executed.

### 4.2. Image Decompression Bombs & Corrupted Files
- **Threat**: Specially crafted image files designed to expand exponentially in memory upon decompression (Zip/image bombs).
- **Defense**: 
  - Image processing executes in the isolated Python subprocess or Sharp C++ addon.
  - Image dimensions are validated prior to full-buffer decompression.
  - Processing failures trigger isolated subprocess termination without crashing the Electron UI.

### 4.3. Operating System Privilege Separation
- Nexora runs with standard user-level permissions.
- Administrative elevation (UAC prompt) is never requested or required for normal browsing, indexing, and organizing within user-accessible directories.
- Protected Windows operating system directories (`C:\Windows`, `C:\Program Files`) are flagged with visual warnings to prevent accidental batch copy operations into system locations.
