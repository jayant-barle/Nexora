# Nexora — AI File Manager for Windows 11

> **"Your files. Your intelligence. Your control."**

[![Version](https://img.shields.io/badge/Version-0.9.0-b4ff32.svg)](VERSION)
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
- 🛡️ **Adaptive Performance Without Feature Loss**: Full feature parity across low-end PCs, mid-range systems, and high-performance computers. Nexora never improves performance by disabling features, reducing AI accuracy, lowering confidence thresholds, skipping required analysis, or weakening data-integrity safeguards.
- ⚡ **Adaptive Scheduling & Dynamic Throttling**: Auto-detects physical hardware (CPU cores/load, total/free RAM, GPU VRAM, SSD/HDD) without administrator privileges. Dynamically switches between Low Resource, Balanced, and Performance modes with 5-second hysteresis anti-oscillation dampening.
- 🎯 **Four-Tier Priority Scheduling**: Keeps UI browsing and instant search instantaneous (Priority 1) and lightweight discovery immediate (Priority 2) by automatically deferring heavy AI face and video analysis (Priority 4) during high memory pressure (>82%) or sustained CPU load (>85%).
- 🔄 **Resumable Processing & Completeness Guarantee**: Files with deferred AI are transparently recorded with `processing_status = 'pending'` and enqueued into persistent Priority 4 background jobs. Every eligible file eventually receives full analysis without false completion or duplicated work.
- 🎬 **Direct Seek Video Analysis & Frame Suppression**: Direct keyframe seeking (`cap.set(cv2.CAP_PROP_POS_FRAMES)`) bypasses sequential frame decoding, cutting video analysis CPU and RAM consumption by >90% while suppressing redundant face scans on static scenes.
- 🧠 **Metadata Intelligence Engine**: Local-only extraction pipeline for images (EXIF camera make/model, lens, orientation, exposure, ISO, GPS), videos (resolution, duration, fps, codec), documents (PDF title, author, subject, page count, and text preview; Office DOCX/PPTX/XLSX Dublin Core properties and word counts), audio (WAV RIFF stream parameters, sample rate, bitrate; MP3 ID3v2 tags), archives (ZIP/TAR entry count and password encryption detection), and plaintext.
- 📂 **Metadata-Based Organization Proposals**: Configurable folder template rules (`{category}/{YYYY}/{MM}/{DD}/{person}/{camera}/{location}/{event}/{author}`) with deterministic safe fallbacks (`Unknown Date`, `Unassigned`, `Unknown Location`, `General`, `Unknown Camera`, `Unknown Author`, `Other Files`), collision avoidance, duplicate detection, and verified copy staging without touching originals.
- ⚡ **Incremental Scanning & Non-Destructive Reconciliation**: Caching compares file timestamps and byte size to skip unchanged files; missing files are flagged (`is_missing = 1`, `availability_status = 'missing'`) without deleting records or user history, and automatically restored upon return.
- 👤 **On-Device Facial Recognition**: Local neural face detection with standardized 1600px image normalization across all profiles, vector embedding, and cosine clustering across photos and videos. Review, name, confirm, hide, or merge identity clusters.
- 🔄 **Safe Perceptual & Hash Deduplication**: Detect bit-for-bit identical files (SHA-256) and visually similar photos (perceptual difference hashing) with non-destructive resolution actions (Keep Best, Move to Trash, Hardlink).
- 🔍 **Instant Smart Search**: High-performance SQLite FTS5 search indexing with filters by filename, extension, file size, date range, tags, camera make/model, author, artist, GPS, and recognized people.
- 📊 **Resource Transparency & Controls Panel**: Settings dashboard with live CPU load, RAM pressure, GPU/VRAM telemetry, persistent job queue monitoring with items/sec throughput, pending AI file counters, master Pause/Resume All button, and worker limits.
- 📅 **EXIF Media Timeline**: Chronologically group and browse photos and videos by Year, Month, or Day derived directly from camera metadata.
- 💾 **Storage Analytics**: Monitor partition capacities, inspect file type distribution across indexed media, and instantly locate heavy disk consumers.
- 👁 **Continuous Folder Watcher**: Automated background detection of new and modified media in monitored folders using `chokidar`.
- ⚡ **Background Worker Queue**: Resilient, priority-driven job processing with live progress telemetry, pause/resume/cancel controls, crash recovery of stranded jobs, and error logs.
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

### Package Windows Executable & Installer
Generate a standalone Windows NSIS installer (`.exe`):
```bash
npm run package
```
*The installer is generated inside the `release/` folder as `Nexora-Setup-0.5.0.exe`.*

To build an unpacked portable application folder for rapid testing without running the installer:
```bash
npm run package:dir
```
*The standalone executable is generated at `release/win-unpacked/Nexora.exe`.*

---

## Documentation & Engineering Specifications

Nexora includes an extensive, production-grade technical documentation system organized in [`docs/`](docs/README.md):

| Document | Category | Purpose & Scope |
| :--- | :--- | :--- |
| [VERSION](VERSION) | Root | Canonical single source of truth for the project version (`0.5.0`) |
| [PROJECT_RULES.md](PROJECT_RULES.md) | Root | Non-negotiable engineering principles & coding rules |
| [CHANGELOG.md](CHANGELOG.md) | Root | Chronological release and change history |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Root / Dev | Contribution standards, code style, and version update workflow |
| [docs/README.md](docs/README.md) | Index | Complete master documentation index and navigation directory |
| [PRD.md](docs/product/PRD.md) | Product | Product requirements, scope, constraints, and acceptance criteria |
| [FEATURES.md](docs/product/FEATURES.md) | Product | Comprehensive catalog of all 10 core features |
| [IMPLEMENTATION_PLAN.md](docs/product/IMPLEMENTATION_PLAN.md) | Product | Phased development roadmap and milestones |
| [ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md) | Architecture | System topology, multi-process IPC, state management, and data flow |
| [DATABASE_SCHEMA.md](docs/architecture/DATABASE_SCHEMA.md) | Architecture | SQLite 3 schema documentation for all 25 tables and FTS5 indices |
| [API.md](docs/architecture/API.md) | Architecture | Complete IPC channel specifications and payload contracts |
| [DEPENDENCIES.md](docs/architecture/DEPENDENCIES.md) | Architecture | Production and development dependency inventory, licenses, and ABI guide |
| [SETUP_WINDOWS.md](docs/development/SETUP_WINDOWS.md) | Development | Windows 11 development environment setup and native build guide |
| [GSD_STYLE.md](docs/development/GSD_STYLE.md) | Development | Get-Stuff-Done engineering standards and delivery workflow |
| [TASKS.md](docs/development/TASKS.md) | Development | Status tracker for completed, in-progress, and planned engineering tasks |
| [FILE_OPERATIONS.md](docs/operations/FILE_OPERATIONS.md) | Operations | Copy-first preservation, SHA-256 verification, and rollback mechanics |
| [WATCH_FOLDERS.md](docs/operations/WATCH_FOLDERS.md) | Operations | Chokidar directory monitoring, debounce windows, and offline re-sync |
| [ERROR_HANDLING.md](docs/operations/ERROR_HANDLING.md) | Operations | Multi-tier error boundaries, database transactions, and crash recovery |
| [TROUBLESHOOTING.md](docs/operations/TROUBLESHOOTING.md) | Operations | Diagnostic playbooks, common error resolutions, and logs |
| [TESTING.md](docs/quality/TESTING.md) | Quality | Automated testing strategy, Vitest commands, and acceptance criteria |
| [PERFORMANCE.md](docs/quality/PERFORMANCE.md) | Quality | Large-library scalability targets, WAL tuning, and 60 FPS rendering |
| [SECURITY.md](docs/security/SECURITY.md) | Security | Security vulnerability disclosure and threat policies |
| [PRIVACY_SECURITY.md](docs/security/PRIVACY_SECURITY.md) | Security | Zero-cloud architecture, biometric data isolation, and Electron hardening |
| [AI_PIPELINE.md](docs/features/AI_PIPELINE.md) | Features | Subprocess JSON-RPC worker, hashing, EXIF, and facial recognition |
| [SEARCH_DUPLICATES.md](docs/features/SEARCH_DUPLICATES.md) | Features | SQLite FTS5 search indexing and exact/perceptual deduplication engine |
| [UI_UX_SPEC.md](docs/features/UI_UX_SPEC.md) | Features | Design tokens, visual identity, and specifications for all 12 views |
| [MODEL_AND_DEPENDENCY_LICENSES.md](docs/MODEL_AND_DEPENDENCY_LICENSES.md) | Compliance | Permissive open-source licenses and redistribution guide |

---

## Project Structure

```
Nexora/
├── .github/                      # CI workflows and issue/PR templates
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.md
│   │   └── feature_request.md
│   ├── workflows/
│   │   └── ci.yml
│   └── PULL_REQUEST_TEMPLATE.md
├── ai-worker/                    # Python AI subprocess inference engine
│   ├── requirements.txt          # Python ML & image dependencies
│   └── src/
│       └── main.py               # JSON-RPC server on stdin/stdout
├── assets/                       # Application icons, images, and branding assets
│   ├── branding/
│   ├── icons/
│   └── images/
├── config/                       # Application configuration specifications
│   └── model_capabilities.yaml   # Hardware profiles & local AI model catalog
├── database/                     # SQLite schema definitions and migrations
│   ├── migrations/
│   │   ├── 001_initial.sql
│   │   ├── 002_metadata_engine.sql
│   │   ├── 003_adaptive_performance.sql
│   │   └── 004_adaptive_scheduler.sql
│   ├── schemas/
│   └── seeds/
├── docs/                         # Categorized technical engineering documentation
│   ├── architecture/             # System topology, API, schema, and dependencies
│   ├── development/              # Setup, contributing guide, and task tracker
│   ├── features/                 # AI pipeline, search/duplicates, UI/UX specs
│   ├── operations/               # File ops, folder monitoring, and error handling
│   ├── product/                  # PRD, feature catalog, and roadmap
│   ├── quality/                  # Testing plan and performance benchmarks
│   ├── security/                 # Threat model and privacy architecture
│   ├── MODEL_AND_DEPENDENCY_LICENSES.md # Permissive open-source licenses
│   └── README.md                 # Master documentation index
├── scripts/                      # Developer and maintenance utility scripts
│   ├── build/
│   ├── development/
│   ├── maintenance/
│   ├── validation/
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
│   ├── unit/                     # 11 unit test suites (68 tests)
│   ├── integration/              # Integration tests
│   ├── e2e/                      # End-to-end tests
│   ├── performance/              # Performance benchmarks
│   └── fixtures/                 # Test sample data
├── .gitignore                    # Comprehensive repository hygiene ignore patterns
├── .npmrc                        # Package manager engine strictness configuration
├── CHANGELOG.md                  # Chronological release and change history
├── CONTRIBUTING.md               # Contribution standards and version update workflow
├── package.json                  # Dependencies, scripts, and build metadata
├── PROJECT_RULES.md              # Non-negotiable engineering principles & coding rules
├── README.md                     # Repository entry point and architecture overview
├── tsconfig.json                 # Renderer TypeScript compiler configuration
├── tsconfig.main.json            # Main process TypeScript compiler configuration
├── VERSION                       # Canonical single source of truth for version (0.5.0)
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
