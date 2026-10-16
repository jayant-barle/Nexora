# Dependency Inventory, Licenses & Maintenance

## Product: Nexora — AI File Manager
**Tagline:** *"Your files. Your intelligence. Your control."*  
**Platform:** Windows 11 Desktop  
**Canonical Version:** `0.1.0`

---

## 1. Overview & Licensing Policy

All third-party libraries and modules integrated into Nexora are governed by commercially friendly, permissive open-source licenses (MIT, Apache 2.0, ISC, and BSD-3-Clause). **No copyleft (GPL / AGPL) libraries are utilized**, ensuring maximum architectural flexibility and distribution freedom.

---

## 2. Production Node.js Dependencies

| Package | Version | License | Role in Nexora | Maintenance & Upgrade Notes |
| :--- | :--- | :--- | :--- | :--- |
| **`better-sqlite3`** | `^11.6.0` | MIT | Embedded SQLite database engine in WAL mode | Native C++ addon. Must be compiled against target Electron ABI via `npx electron-builder install-app-deps`. |
| **`chokidar`** | `^4.0.3` | MIT | Real-time filesystem directory monitoring | Pure JS in v4. Monitors `watch_roots` directories via Windows OS event hooks. |
| **`electron-store`** | `^10.0.0` | MIT | Lightweight persistent user preferences | Manages window geometry, last-used theme, and explorer display preferences. |
| **`exif-reader`** | `^2.0.1` | MIT | Fast binary EXIF header parsing | Node-level fallback for reading camera and capture date tags. |
| **`sharp`** | `^0.33.5` | Apache-2.0 | High-performance image transform & thumbnailing | Uses libvips C++ binaries. Native addon with pre-built Windows binaries. |
| **`uuid`** | `^10.0.0` | MIT | RFC4122 cryptographic UUID generation | Generates primary keys for `files`, `roots`, `jobs`, `people`, and `copy_operations`. |
| **`xxhash-wasm`** | `^1.1.0` | MIT | WebAssembly-accelerated non-cryptographic hash | Fast shallow change detection for files prior to computing full SHA-256. |

---

## 3. Frontend & Development Dependencies

| Package | Version | License | Role in Nexora |
| :--- | :--- | :--- | :--- |
| **`electron`** | `^33.2.1` | MIT | Desktop runtime bundling Chromium and Node.js. |
| **`react`** | `^18.3.1` | MIT | Declarative UI component library. |
| **`react-dom`** | `^18.3.1` | MIT | DOM mounting via `createRoot` for React 18. |
| **`zustand`** | `^5.0.2` | MIT | High-performance scoped state management without provider wrappers. |
| **`lucide-react`** | `^0.468.0` | ISC | Modern Windows 11 Fluent-styled SVG iconography. |
| **`vite`** | `^6.0.3` | MIT | Next-generation frontend bundler and development server. |
| **`@vitejs/plugin-react`** | `^4.3.4` | MIT | Fast React Fast Refresh and JSX transformation. |
| **`typescript`** | `^5.7.2` | Apache-2.0 | Static type safety and strict checking across all tiers. |
| **`vitest`** | `^2.1.8` | MIT | Blazing-fast Vite-native unit test runner. |
| **`electron-builder`** | `^25.1.8` | MIT | Windows installer generation (NSIS) and portable distribution packager. |
| **`concurrently`** | `^9.1.0` | MIT | Concurrent execution of Vite dev server and Electron main compiler. |

---

## 4. Python Subprocess Dependencies (`ai-worker`)

The Python AI worker operates in `ai-worker/src/main.py`. Dependencies are recorded in `ai-worker/requirements.txt`:

| Package | Minimum Version | License | Required / Optional | Capability Provided |
| :--- | :--- | :--- | :--- | :--- |
| **`Pillow`** | `>=10.0.0` | HPND | Optional (Graceful fallback) | Perceptual 8x8 difference hashing (`dHash`), EXIF parsing, GPS conversion, Lanczos thumbnails. |
| **`numpy`** | `>=1.24.0` | BSD-3-Clause | Optional (Graceful fallback) | Vectorized cosine distance clustering for facial embedding vectors. |
| **`opencv-python-headless`** | `>=4.8.0` | Apache-2.0 | Optional | Neural face detection and image pre-processing without GUI window dependencies. |
| **`insightface`** | `>=0.7.3` | MIT | Optional | State-of-the-art local face embedding extraction. |

---

## 5. Maintenance Procedures & Native Module ABI

### 5.1. Electron ABI Rebuilding
Electron uses a different V8 and Node.js ABI than standard Node.js installations. Whenever Electron or `better-sqlite3` is upgraded:
```powershell
npm run postinstall
# Or explicitly:
npx electron-builder install-app-deps
```
This re-compiles `better-sqlite3` to match Electron's internal Node ABI (e.g., ABI 130 for Electron 33).

### 5.2. Security Audit & Upgrades
Run regular vulnerability scans:
```powershell
npm audit
```
Patch minor dependency versions using `npm update` while validating test suites (`npm test` and `npm run typecheck`).
