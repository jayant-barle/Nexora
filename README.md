# AI File Manager for Windows 11

[![Node.js Version](https://img.shields.io/badge/Node.js-18%2B-brightgreen)](https://nodejs.org/)
[![Electron Version](https://img.shields.io/badge/Electron-33.2.1-blue)](https://www.electronjs.org/)
[![React Version](https://img.shields.io/badge/React-18.3.1-61dafb)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7.2-blue)](https://www.typescriptlang.org/)
[![Python](https://img.shields.io/badge/Python-3.10%2B-yellow)](https://www.python.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

An intelligent, local-first desktop file management system for Windows 11. **AI File Manager** unites native Windows filesystem capabilities with on-device AI to provide facial recognition, perceptual deduplication, EXIF timeline visualization, natural search, and automated organization—all executed completely offline with zero cloud telemetry.

---

## Key Features

- 📁 **Native Windows File Explorer**: Full disk navigation across logical drives (`C:`, `D:`, etc.), path breadcrumbs, sorting, list/grid toggles, and direct integration with native Windows File Explorer.
- 👤 **On-Device Facial Recognition**: Local neural face detection, vector embedding, and cosine clustering. Review, name, confirm, hide, or merge identity clusters.
- 🔄 **Safe Perceptual & Hash Deduplication**: Detect bit-for-bit identical files (SHA-256) and visually similar photos (perceptual difference hashing) with non-destructive resolution actions (Keep Best, Move to Trash, Hardlink).
- 🔍 **Instant Smart Search**: High-performance SQLite FTS5 search indexing with filters by filename, extension, file size, date range, tags, and recognized people.
- 📅 **EXIF Media Timeline**: Chronologically group and browse photos and videos by Year, Month, or Day derived directly from camera metadata.
- 💾 **Storage Analytics**: Monitor partition capacities, inspect file type distribution across indexed media, and instantly locate heavy disk consumers.
- 👁 **Continuous Folder Watcher**: Automated background detection of new and modified media in monitored folders using `chokidar`.
- ⚡ **Background Worker Queue**: Resilient, priority-driven job processing with live progress telemetry, pause/resume/cancel controls, and error logs.
- 📜 **Non-Destructive Operations & Rollback**: Safe copy-based file reorganizations with mandatory checksum verifications and instant one-click rollback.
- 🎨 **Modern Windows 11 Fluent UI**: Dark charcoal aesthetic, neon-lime accents, smooth micro-animations, glassmorphism, and responsive layouts.

---

## Technology Stack

| Layer | Technology | Description |
| :--- | :--- | :--- |
| **Desktop Shell** | [Electron 33](https://www.electronjs.org/) | Cross-process desktop platform with `contextIsolation` and hardened security |
| **Frontend UI** | [React 18](https://react.dev/) | Component architecture mounted with `ReactDOM.createRoot` |
| **Bundler & Dev** | [Vite 6](https://vite.dev/) | Ultra-fast HMR and optimized production bundling |
| **Language** | [TypeScript 5.7+](https://www.typescriptlang.org/) | End-to-end type safety across Main, Preload, Renderer, and Shared layers |
| **State Management** | [Zustand 5](https://github.com/pmndrs/zustand) | Lightweight, hook-based stores for navigation, explorer, jobs, and watchers |
| **Database** | [better-sqlite3 11](https://github.com/WiseLibs/better-sqlite3) | High-speed local embedded database with WAL mode and versioned migrations |
| **AI Inference** | Python 3 Subprocess | JSON-RPC local worker for hashing, EXIF extraction, and face clustering |
| **Styling** | Vanilla CSS Tokens | Zero runtime CSS-in-JS overhead; custom Windows 11 design system |
| **Testing** | [Vitest 2](https://vitest.dev/) | Unit test runner with fast native TypeScript execution |

---

## Architecture Overview

```
+-------------------------------------------------------------------------+
|                          Electron Desktop Shell                         |
|                                                                         |
|  +-------------------------------------------------------------------+  |
|  |                     React 18 Renderer UI                          |  |
|  |  * 12 Dedicated Views (Dashboard, Explorer, People, Duplicates...) |  |
|  |  * Zustand Store (Navigation, Explorer, Jobs, Watchers, People)   |  |
|  +---------------------------------+---------------------------------+  |
|                                    | window.electronAPI (contextBridge) |
|  +---------------------------------v---------------------------------+  |
|  |                     Electron Main Process                         |  |
|  |  * Window Management, Security Enforcement & Sandboxing          |  |
|  |  * Native Windows Drive & Filesystem APIs (wmic / child_process)   |  |
|  |  * SQLite DB (better-sqlite3, WAL mode, FTS5)                    |  |
|  |  * Background Task Manager & Job Queue                            |  |
|  +---------------------------------+---------------------------------+  |
|                                    | JSON-RPC (stdin / stdout)          |
|  +---------------------------------v---------------------------------+  |
|  |                     Python AI Worker Subprocess                   |  |
|  |  * SHA-256 & Perceptual Hashing (dHash)                           |  |
|  |  * EXIF & GPS Metadata Extraction                                 |  |
|  |  * Face Detection, Embedding & Cosine Distance Clustering        |  |
+--+-------------------------------------------------------------------+--+
```

---

## Prerequisites

- **Operating System**: Windows 10 or Windows 11 (64-bit)
- **Node.js**: `v18.0.0` or newer (`v20+` or `v22+` recommended)
- **npm**: `v9.0.0` or newer
- **Python**: `v3.10` or newer (accessible via system `PATH` as `python`)

---

## Installation & Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/your-username/ai-file-manager.git
   cd "ai-file-manager"
   ```

2. **Install Node.js dependencies**:
   ```bash
   npm install --ignore-scripts
   ```

3. **Rebuild native C++ modules for Electron**:
   Because `better-sqlite3` is a compiled native C++ addon, compile it against your installed Electron version:
   ```bash
   npx electron-builder install-app-deps
   ```

4. **Install Python AI Worker dependencies (Optional)**:
   The Python AI worker contains pure-Python fallbacks. For enhanced image processing and perceptual hashing, install optional packages:
   ```bash
   pip install -r ai-worker/requirements.txt
   ```

---

## Development & Execution

### Run in Development Mode
To start both the Vite development server and the Electron application concurrently:
```bash
npm run dev
```

Or run the processes in separate terminal sessions:
```bash
# Terminal 1: Start Vite renderer dev server (http://localhost:5173)
npm run dev:renderer

# Terminal 2: Compile TypeScript main process and launch Electron
npm run dev:main
```

### Run Unit Tests
```bash
npm test
```

### Run TypeScript Typechecking
```bash
npm run typecheck
npm run typecheck:main
```

### Production Build
Compile both the React renderer and the Electron main process bundles:
```bash
npm run build
```

The compiled assets will be placed into the `dist/` directory:
- `dist/renderer/` — Optimized HTML, CSS, and JS bundle
- `dist/main/` — Compiled Electron main process scripts
- `dist/preload/` — Preload bridge scripts

### Package Desktop Executable
Generate a standalone Windows NSIS installer (`.exe`):
```bash
npm run package
```
*Installers are generated inside the `release/` folder.*

---

## Project Structure

```
ai-file-manager/
├── ai-worker/                    # Python AI subprocess inference engine
│   ├── requirements.txt          # Python ML & image dependencies
│   └── src/
│       └── main.py               # JSON-RPC server on stdin/stdout
├── assets/                       # Application icons and static assets
├── database/                     # SQLite schema definitions
│   └── migrations/
│       └── 001_initial.sql       # Versioned SQLite initial schema
├── docs/                         # Extended technical documentation
│   └── ARCHITECTURE.md           # Detailed architectural breakdown
├── scripts/                      # Developer utility scripts
│   └── migrate.js                # Standalone database migration runner
├── src/
│   ├── main/                     # Electron Main Process (Node.js)
│   │   ├── database.ts           # SQLite connection, queries, and migrations
│   │   ├── filesystem.ts         # Drive detection and Windows filesystem ops
│   │   ├── index.ts              # Window lifecycle and security controls
│   │   └── ipc-handlers.ts       # IPC channel registration & input validation
│   ├── preload/                  # Secure Preload Bridge
│   │   └── index.ts              # contextBridge API exposing window.electronAPI
│   ├── renderer/                 # React 18 UI Application
│   │   ├── components/           # Reusable UI components (Sidebar, Modals)
│   │   ├── pages/                # 12 functional view pages
│   │   ├── services/api.ts       # Type-safe API bridge with browser fallback
│   │   ├── store/index.ts        # Zustand global state stores
│   │   ├── styles/               # CSS Design tokens and global rules
│   │   ├── App.tsx               # Application shell and view switcher
│   │   ├── index.html            # Vite HTML entry point
│   │   └── main.tsx              # React DOM mounting
│   └── shared/                   # Shared TypeScript contracts
│       └── types.ts              # Common data models, IPC types, and defaults
├── tests/                        # Automated test suites
│   └── unit/                     # Vitest unit test files
├── package.json                  # Dependencies, scripts, and build metadata
├── tsconfig.json                 # Renderer TypeScript compiler configuration
├── tsconfig.main.json            # Main process TypeScript compiler configuration
├── vite.config.ts                # Vite renderer build configuration
└── vitest.config.ts              # Vitest test configuration
```

---

## Troubleshooting

### 1. `better-sqlite3.node` Bindings Error
**Symptom**: `Error: Could not locate the bindings file` when launching the main process.  
**Resolution**: Run `npx electron-builder install-app-deps`. Ensure Visual Studio C++ Build Tools or Windows SDK is present if compiling from source.

### 2. Python Subprocess Not Responding
**Symptom**: Face detection or hashing tasks remain pending.  
**Resolution**: Verify that `python` is available in your system `PATH` by running `python --version` in PowerShell. The worker communicates over standard input/output using JSON Lines.

### 3. Blank White Screen in Development
**Symptom**: Electron window opens with a blank screen.  
**Resolution**: Ensure the Vite dev server is running on `http://localhost:5173`. Start the renderer first with `npm run dev:renderer` before launching `npm run dev:main`.

---

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
