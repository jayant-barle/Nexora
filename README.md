# Nexora — AI File Manager for Windows 11

> **"Your files. Your intelligence. Your control."**

[![Version](https://img.shields.io/badge/Version-0.3.0-b4ff32.svg)](VERSION)
[![Node.js Version](https://img.shields.io/badge/Node.js-18%2B-brightgreen)](https://nodejs.org/)
[![Electron Version](https://img.shields.io/badge/Electron-33.2.1-blue)](https://www.electronjs.org/)
[![React Version](https://img.shields.io/badge/React-18.3.1-61dafb)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7.2-blue)](https://www.typescriptlang.org/)
[![Python](https://img.shields.io/badge/Python-3.10%2B-yellow)](https://www.python.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

**Nexora** is an intelligent, local-first desktop file management system for Windows 11. Designed with a cinematic, futuristic, minimal visual identity—deep black and charcoal surfaces with restrained neon-lime accents and subtle glass effects—Nexora unites native Windows filesystem capabilities with on-device artificial intelligence. 

All metadata intelligence, face recognition, perceptual deduplication, EXIF timeline visualization, natural search, and media organization run **100% locally on your machine with zero cloud uploads or telemetry**.

---

## Primary Features

- 📁 **Native Windows File Explorer**: Full disk navigation across logical drives (`C:`, `D:`, etc.), path breadcrumbs, sorting, list/grid toggles, and direct integration with native Windows File Explorer.
- 🧠 **Metadata Intelligence Engine**: Local-only extraction pipeline for images (EXIF camera make/model, lens, orientation, exposure, ISO, GPS), videos (resolution, duration, fps, codec), documents (PDF title, author, subject, page count, and text preview; Office DOCX/PPTX/XLSX Dublin Core properties and word counts), audio (WAV RIFF stream parameters, sample rate, bitrate; MP3 ID3v2 tags), archives (ZIP/TAR entry count and password encryption detection), and plaintext.
- 📂 **Metadata-Based Organization Proposals**: Configurable folder template rules (`{category}/{YYYY}/{MM}/{DD}/{person}/{camera}/{location}/{event}/{author}`) with deterministic safe fallbacks (`Unknown Date`, `Unassigned`, `Unknown Location`, `General`, `Unknown Camera`, `Unknown Author`, `Other Files`), collision avoidance, duplicate detection, and verified copy staging without touching originals.
- ⚡ **Incremental Scanning & Non-Destructive Reconciliation**: Caching compares file timestamps and byte size to skip unchanged files; missing files are flagged (`is_missing = 1`, `availability_status = 'missing'`) without deleting records or user history, and automatically restored upon return.
- 👤 **On-Device Facial Recognition**: Local neural face detection, vector embedding, and cosine clustering across photos and videos. Review, name, confirm, hide, or merge identity clusters.
- 🔄 **Safe Perceptual & Hash Deduplication**: Detect bit-for-bit identical files (SHA-256) and visually similar photos (perceptual difference hashing) with non-destructive resolution actions (Keep Best, Move to Trash, Hardlink).
- 🔍 **Instant Smart Search**: High-performance SQLite FTS5 search indexing with filters by filename, extension, file size, date range, tags, camera make/model, author, artist, GPS, and recognized people.
- 📅 **EXIF Media Timeline**: Chronologically group and browse photos and videos by Year, Month, or Day derived directly from camera metadata.
- 💾 **Storage Analytics**: Monitor partition capacities, inspect file type distribution across indexed media, and instantly locate heavy disk consumers.
- 👁 **Continuous Folder Watcher**: Automated background detection of new and modified media in monitored folders using `chokidar`.
- ⚡ **Background Worker Queue**: Resilient, priority-driven job processing with live progress telemetry, pause/resume/cancel controls, and error logs.
- 📜 **Non-Destructive Operations & Rollback**: Safe copy-based file reorganizations with mandatory checksum verifications and instant one-click rollback.
- 🎨 **Cinematic Windows 11 Visual Identity**: Dark charcoal surfaces (`#0a0a0a`), vibrant neon-lime accents (`#b4ff32`), glassmorphism, smooth micro-animations, and responsive layouts.

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
|                        Nexora Desktop Shell                             |
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
   git clone https://github.com/your-username/nexora.git
   cd "nexora"
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
*Installers are generated inside the `release/` folder as `Nexora Setup <version>.exe`.*

---

## Documentation & Engineering Specifications

Nexora includes an extensive, production-grade technical documentation system:

| Document | Purpose & Scope |
| :--- | :--- |
| [VERSION](file:///e:/Code%20Tresure/File%20manager/VERSION) | Canonical single source of truth for the project version (`0.1.0`) |
| [PRD.md](file:///e:/Code%20Tresure/File%20manager/PRD.md) | Product requirements, scope, constraints, and acceptance criteria |
| [ARCHITECTURE.md](file:///e:/Code%20Tresure/File%20manager/ARCHITECTURE.md) | System topology, multi-process IPC, state management, and data flow |
| [FILE_OPERATIONS.md](file:///e:/Code%20Tresure/File%20manager/FILE_OPERATIONS.md) | Copy-first preservation, SHA-256 verification, and rollback mechanics |
| [AI_PIPELINE.md](file:///e:/Code%20Tresure/File%20manager/AI_PIPELINE.md) | Subprocess JSON-RPC worker, hashing, EXIF, and facial recognition |
| [PRIVACY_SECURITY.md](file:///e:/Code%20Tresure/File%20manager/PRIVACY_SECURITY.md) | Zero-cloud architecture, biometric data isolation, and Electron hardening |
| [SEARCH_DUPLICATES.md](file:///e:/Code%20Tresure/File%20manager/SEARCH_DUPLICATES.md) | SQLite FTS5 search indexing and exact/perceptual deduplication engine |
| [WATCH_FOLDERS.md](file:///e:/Code%20Tresure/File%20manager/WATCH_FOLDERS.md) | Chokidar directory monitoring, debounce windows, and offline re-sync |
| [ERROR_HANDLING.md](file:///e:/Code%20Tresure/File%20manager/ERROR_HANDLING.md) | Multi-tier error boundaries, database transactions, and crash recovery |
| [PERFORMANCE.md](file:///e:/Code%20Tresure/File%20manager/PERFORMANCE.md) | Large-library scalability targets, WAL tuning, and 60 FPS rendering |
| [DEPENDENCIES.md](file:///e:/Code%20Tresure/File%20manager/DEPENDENCIES.md) | Production and development dependency inventory, licenses, and ABI guide |
| [DATABASE_SCHEMA.md](file:///e:/Code%20Tresure/File%20manager/DATABASE_SCHEMA.md) | SQLite 3 schema documentation for all 25 tables and FTS5 indices |
| [UI_UX_SPEC.md](file:///e:/Code%20Tresure/File%20manager/UI_UX_SPEC.md) | Design tokens, visual identity, and specifications for all 12 views |
| [API.md](file:///e:/Code%20Tresure/File%20manager/API.md) | Complete IPC channel specifications and payload contracts |
| [IMPLEMENTATION_PLAN.md](file:///e:/Code%20Tresure/File%20manager/IMPLEMENTATION_PLAN.md) | Phased development roadmap and milestones |
| [TASKS.md](file:///e:/Code%20Tresure/File%20manager/TASKS.md) | Status tracker for completed, in-progress, and planned engineering tasks |
| [TESTING.md](file:///e:/Code%20Tresure/File%20manager/TESTING.md) | Automated testing strategy, Vitest commands, and acceptance criteria |
| [SECURITY.md](file:///e:/Code%20Tresure/File%20manager/SECURITY.md) | Security vulnerability disclosure and threat policies |
| [CHANGELOG.md](file:///e:/Code%20Tresure/File%20manager/CHANGELOG.md) | Chronological release and change history |
| [CONTRIBUTING.md](file:///e:/Code%20Tresure/File%20manager/CONTRIBUTING.md) | Contribution standards, code style, and version update workflow |

---

## Project Structure

```
nexora/
├── ai-worker/                    # Python AI subprocess inference engine
│   ├── requirements.txt          # Python ML & image dependencies
│   └── src/
│       └── main.py               # JSON-RPC server on stdin/stdout
├── assets/                       # Application icons and static assets
├── database/                     # SQLite schema definitions
│   └── migrations/
│       └── 001_initial.sql       # Versioned SQLite initial schema
├── docs/                         # Extended technical documentation
│   ├── ARCHITECTURE.md           # Detailed architectural breakdown
│   └── PRD.md                    # Product requirements document
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

## Trademark & Distribution Notice

**Nexora** is the official trademark and product name. Before public release or commercial distribution:
1. Ensure the Windows Application User Model ID (`AppId`) is set to `com.nexora.app`.
2. Verify trademark and namespace availability in target application stores (e.g., Microsoft Store, winget).
3. Ensure distribution packages do not bundle uncredited proprietary assets or third-party trademarks.

---

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
