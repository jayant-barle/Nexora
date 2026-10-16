# Security Policy & Architecture

## Project: AI File Manager for Windows 11
**Version:** 1.0.0  
**Security Model:** Local-First, Sandboxed Chromium Renderer, Least Privilege IPC  

---

## 1. Threat Model & Security Posture

Desktop applications handling user files face distinct threat vectors compared to traditional web applications. **AI File Manager** interacts directly with the local Windows filesystem, executes image processing algorithms on untrusted user media, and performs background batch file copies.

### Threat Vectors Considered:
1. **Malicious File Paths & Path Traversal**: Attackers attempting to pass malicious path strings containing `../` or null bytes (`\0`) to read or overwrite system directories.
2. **Remote Code Execution (RCE) via Chromium Exploits**: Malicious web content or injected scripts attempting to break out of the browser context into the Node.js runtime.
3. **Exploits in Image/Media Parsers**: Corrupted image headers (EXIF, JPEG, PNG) designed to cause buffer overflows or memory corruption in image decoders.
4. **Accidental Data Loss during Organization**: Destructive move or delete operations that could corrupt personal photos or lose files upon system crashes or disk disconnects.

---

## 2. Electron Security Controls

AI File Manager strictly adheres to the official [Electron Security Best Practices](https://www.electronjs.org/docs/latest/tutorial/security):

```
+-------------------------------------------------------------+
|                      Renderer Process                       |
|  * nodeIntegration: false                                   |
|  * contextIsolation: true                                   |
|  * Content Security Policy (CSP): Strict 'self'             |
|  * Zero direct OS or Node.js access                         |
+------------------------------+------------------------------+
                               |
                   contextBridge (Filtered API)
                               |
+------------------------------v------------------------------+
|                     Electron Main Process                   |
|  * Validates every argument (path, UUID, string)            |
|  * Intercepts and denies popup windows                      |
|  * Blocks external URL navigation                           |
|  * Executes local operations safely                         |
+-------------------------------------------------------------+
```

### 2.1 Context Isolation & Node Integration
In [src/main/index.ts](file:///e:/Code%20Tresure/File%20manager/src/main/index.ts):
- `contextIsolation: true`: Ensures that both the preload script and Electron internals run in a separate execution context from the website/DOM. The renderer cannot access or overwrite preload prototypes.
- `nodeIntegration: false`: Completely disables Node.js primitives (`require`, `process`, `Buffer`) in the renderer process.

### 2.2 Strict Content Security Policy (CSP)
Defined in [src/renderer/index.html](file:///e:/Code%20Tresure/File%20manager/src/renderer/index.html):
```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: file: https:;" />
```
- **`script-src 'self'`**: Forbids execution of inline scripts (`eval()`, `new Function()`) and prohibits loading scripts from remote domains.
- **`default-src 'self'`**: Restricts all generic connections and fetches to the local application package.

### 2.3 Navigation & Window Open Lockdown
To prevent phishing or involuntary redirect exploits:
```typescript
app.on('web-contents-created', (_event, contents) => {
  // Deny creation of new windows or popups
  contents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });

  // Intercept and prevent navigation away from the application
  contents.on('will-navigate', (event, url) => {
    if (isDev && url.startsWith('http://localhost:')) return;
    event.preventDefault();
  });
});
```

---

## 3. Filesystem Input Validation & Sanitization

All incoming IPC parameters traversing from the renderer to the main process undergo strict validation in [src/main/ipc-handlers.ts](file:///e:/Code%20Tresure/File%20manager/src/main/ipc-handlers.ts):

### 3.1 Path Normalization & Null-Byte Defense
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

### 3.2 ID Sanitization
```typescript
function validateId(value: unknown): string {
  const str = validateString(value, 'id');
  if (!/^[a-f0-9-]{36}$/i.test(str) && !/^[a-zA-Z0-9_-]+$/.test(str)) {
    throw new Error('Invalid ID format');
  }
  return str;
}
```
*Prevents SQL injection when IDs are interpolated into dynamic queries.*

---

## 4. Local-First Privacy Guarantee

- **Zero Cloud Ingestion**: The application contains no analytics tracking, no third-party telemetry beacons, and no cloud-dependent AI APIs.
- **Local Neural Inference**: All facial detection, embedding vectors, and clustering are computed entirely on the user's local machine via the Python worker.
- **Local Data Storage**: The SQLite database and generated thumbnails reside exclusively in the user's local `%APPDATA%\ai-file-manager\` directory.

---

## 5. Non-Destructive Operations & Data Integrity

To prevent accidental data loss:
1. **Copy-First Semantic**: Automatic media reorganization copies files to a designated `managedLibraryPath` rather than moving or deleting originals.
2. **SHA-256 Hash Verification**: Source and destination files are cryptographically compared before an operation item is verified.
3. **Audit Trail & Rollback**: Every batch file operation logs its metadata to `copy_operations` and `operation_items`, allowing users to undo changes and safely remove copied duplicates.

---

## 6. Vulnerability Reporting

If you discover a security vulnerability in AI File Manager, please report it privately:
- **Email**: `security@aifilemanager.local` (or file a private security advisory on GitHub).
- **Include**:
  - Description of the vulnerability.
  - Step-by-step reproduction instructions or proof-of-concept.
  - Affected operating system and application version.
- **Response Timeline**: We acknowledge reports within 48 hours and aim to provide remediation patches within 14 days.
