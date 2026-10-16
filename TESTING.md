# Testing Strategy & Quality Assurance

## Product: Nexora — AI File Manager
**Tagline:** *"Your files. Your intelligence. Your control."*  
**Version:** 0.1.0  
**Test Framework:** [Vitest 2.1.8](https://vitest.dev/)  
**Environment:** Node.js / Windows 11  

---

## 1. Testing Philosophy & Architecture

**Nexora** adopts a multi-tiered testing strategy emphasizing data safety, path isolation, and deterministic execution:

1. **Unit Testing**: Focuses on core utility functions, path normalization, safety guards, input validation, and data model invariants. Fast, zero-dependency, and executed in milliseconds.
2. **Subprocess & Worker Testing**: Verifies that the Python AI inference engine adheres strictly to the JSON-RPC protocol over standard input/output.
3. **IPC Bridge & Service Testing**: Validates that renderer stores interact cleanly with mocked and real Electron APIs without leaking sensitive OS handles.
4. **Manual Acceptance Testing**: Rigorous desktop QA on Windows 11 verifying UI fluidity, drive mounting/unmounting, file selection, and non-destructive library operations.

---

## 2. Test Setup & Execution

### 2.1 Configuration
The testing environment is configured in [vitest.config.ts](file:///e:/Code%20Tresure/File%20manager/vitest.config.ts):
```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@renderer': path.resolve(__dirname, 'src/renderer'),
      '@main': path.resolve(__dirname, 'src/main'),
    },
  },
});
```

### 2.2 Test Commands

| Command | Action |
| :--- | :--- |
| `npm test` | Run all unit test suites once and report results |
| `npm run test:watch` | Start Vitest in interactive watch mode for TDD |
| `npm run typecheck` | Run TypeScript compiler typecheck on renderer & shared code |
| `npm run typecheck:main` | Run TypeScript compiler typecheck on Electron main & preload |

---

## 3. Implemented Test Suites

### 3.1 Filesystem Safety & Path Normalization (`tests/unit/filesystem.test.ts`)
Validates that filesystem operations enforce Windows security policies:
- **Windows Path Normalization**: Asserts that relative path traversal segments (`..`) are properly resolved to prevent directory traversal exploits.
- **Null-Byte Injection Detection**: Verifies that null bytes (`\0`) within user-supplied paths are caught immediately before hitting Node.js or OS APIs.
- **Drive Letter Root Parsing**: Verifies that Windows absolute paths (e.g. `E:\Code Tresure\...`) correctly identify the drive root (`E:\`) and extension (`.json`).
- **Parent Navigation Calculation**: Tests navigation logic ensuring folder up-navigation resolves safely to the immediate parent directory.

### 3.2 Types & Settings Invariants (`tests/unit/types.test.ts`)
Validates default configuration constants and safety defaults:
- **Safe Default Settings**: Asserts that default theme is dark, minimum concurrent workers is at least 1, face detection confidence exceeds 0.5, and hash verification defaults to `true`.
- **Watcher Debounce Time**: Asserts that the Windows directory watcher debounces events by at least 1,000ms to protect against file lock thrashing during massive copy operations.

---

## 4. Verification Results

Current test execution summary:
```
 ✓ tests/unit/filesystem.test.ts (4 tests) 2ms
 ✓ tests/unit/types.test.ts (2 tests) 2ms

 Test Files  2 passed (2)
      Tests  6 passed (6)
   Duration  389ms
```

---

## 5. Planned Integration & End-to-End Testing

### 5.1 SQLite Database Integration Testing (Planned)
- **Objective**: Test high-concurrency inserts and FTS5 search queries.
- **Test Scenarios**:
  1. Insert 5,000 file records in a single transaction and verify `search_index` virtual table updates.
  2. Simulate concurrent writes from multiple worker jobs and verify `busy_timeout` prevents `SQLITE_BUSY` exceptions.
  3. Verify foreign key cascade deletions (`DELETE FROM people WHERE id = ?` correctly cascades to `file_people` and `face_clusters`).

### 5.2 Python AI Worker JSON-RPC Testing (Planned)
- **Objective**: Verify standard input/output protocol contracts directly.
- **Test Scenarios**:
  1. Send `{"id": 1, "action": "ping"}` and assert `{"id": 1, "status": "ok", "result": {"pong": true}}`.
  2. Send `{"action": "compute_hashes", "params": {"file_path": "sample.jpg"}}` and verify 64-character SHA-256 hex string.
  3. Send malformed JSON line and assert worker returns structured `{"status": "error"}` without process termination.

---

## 6. Manual Acceptance Testing Checklist (Windows 11)

| Area | Test Case | Expected Behavior | Result |
| :--- | :--- | :--- | :---: |
| **Window Shell** | Launch application | Window opens smoothly with dark theme; no menu bar visible in production | Pass |
| **Drive Listing** | Open Explorer view | All active Windows logical drives (`C:`, `D:`, etc.) are detected with accurate used/free space | Pass |
| **Navigation** | Double-click directory | Enters directory, updates breadcrumbs, and displays child files and folders | Pass |
| **Search** | Enter query in header | Navigates to Search view and displays filtered database results with execution time | Pass |
| **Indexing** | Click "Index Folder" | Opens Windows native folder picker; queuing task triggers active job pill | Pass |
| **Duplicates** | View Duplicates tab | Displays identified exact hash clones and perceptual similarities | Pass |
| **Settings** | Update slider & save | Settings persist to SQLite database across application reloads | Pass |
| **Offline Mode** | Disconnect WiFi | All features, local AI, and searches continue operating with zero degradation | Pass |
