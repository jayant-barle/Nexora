# Nexora — Documentation Index

> **"Your files. Your intelligence. Your control."**  
> **Product Version:** `0.5.0`  
> **Platform:** Windows 11 Desktop (64-bit)  

Welcome to the **Nexora Engineering & Product Documentation**. All technical documentation is organized by domain below.

---

## Documentation Categories

```
docs/
├── product/              # Product requirements, feature catalog & roadmap
├── architecture/         # System topology, database schema & IPC contracts
├── operations/           # Filesystem safety, monitoring & error recovery
├── quality/              # Automated QA test plans & performance benchmarks
├── security/             # Air-gapped privacy guarantee & Electron hardening
├── development/          # Contributor guide, setup & engineering standards
└── features/             # Deep technical specifications for AI, search & UI
```

---

### 1. Product Documentation (`docs/product/`)
| Document | Description |
| :--- | :--- |
| [**PRD.md**](file:///e:/Code%20Tresure/File%20manager/docs/product/PRD.md) | Authoritative Product Requirements Document: scope, user personas, functional requirements, and non-functional constraints. |
| [**FEATURES.md**](file:///e:/Code%20Tresure/File%20manager/docs/product/FEATURES.md) | Comprehensive feature matrix and capability catalog across all 10 core subsystems. |
| [**IMPLEMENTATION_PLAN.md**](file:///e:/Code%20Tresure/File%20manager/docs/product/IMPLEMENTATION_PLAN.md) | Phased engineering implementation roadmap and delivery milestones (Phases 1 through 7). |

---

### 2. System Architecture (`docs/architecture/`)
| Document | Description |
| :--- | :--- |
| [**ARCHITECTURE.md**](file:///e:/Code%20Tresure/File%20manager/docs/architecture/ARCHITECTURE.md) | System topology, multi-process IPC, state management, and Architecture Decision Records (ADR-01 through ADR-05). |
| [**DATABASE_SCHEMA.md**](file:///e:/Code%20Tresure/File%20manager/docs/architecture/DATABASE_SCHEMA.md) | Complete SQLite 3 schema documentation: 25 relational tables, FTS5 virtual tables, and ERD diagram. |
| [**API.md**](file:///e:/Code%20Tresure/File%20manager/docs/architecture/API.md) | Preload `contextBridge` API specifications, IPC channel contracts, and JSON-RPC payloads. |
| [**DEPENDENCIES.md**](file:///e:/Code%20Tresure/File%20manager/docs/architecture/DEPENDENCIES.md) | Production and development dependency inventory, license classifications, and Electron ABI compilation guide. |

---

### 3. Operations & Reliability (`docs/operations/`)
| Document | Description |
| :--- | :--- |
| [**FILE_OPERATIONS.md**](file:///e:/Code%20Tresure/File%20manager/docs/operations/FILE_OPERATIONS.md) | Copy-first file preservation, mandatory pre/post SHA-256 checksums, and reversible rollback mechanics. |
| [**WATCH_FOLDERS.md**](file:///e:/Code%20Tresure/File%20manager/docs/operations/WATCH_FOLDERS.md) | Real-time filesystem monitoring via Chokidar with 2000ms sliding debounce window. |
| [**ERROR_HANDLING.md**](file:///e:/Code%20Tresure/File%20manager/docs/operations/ERROR_HANDLING.md) | Multi-tier fault tolerance across Renderer, Electron Main, and Python subprocess worker. |
| [**TROUBLESHOOTING.md**](file:///e:/Code%20Tresure/File%20manager/docs/operations/TROUBLESHOOTING.md) | Diagnostic guide for Windows runtime, Python environment, native module compilation, and database recovery. |

---

### 4. Quality & Performance (`docs/quality/`)
| Document | Description |
| :--- | :--- |
| [**TESTING.md**](file:///e:/Code%20Tresure/File%20manager/docs/quality/TESTING.md) | Automated QA test plan: 11 test suites, 67 tests, 100% pass rate, and invariant verification specs. |
| [**PERFORMANCE.md**](file:///e:/Code%20Tresure/File%20manager/docs/quality/PERFORMANCE.md) | Scalability benchmarks, memory targets, 60 FPS rendering specs, and SQLite WAL pragma tuning. |

---

### 5. Security & Privacy (`docs/security/`)
| Document | Description |
| :--- | :--- |
| [**SECURITY.md**](file:///e:/Code%20Tresure/File%20manager/docs/security/SECURITY.md) | Threat model, Electron security hardening (CSP, context isolation), and vulnerability reporting policies. |
| [**PRIVACY_SECURITY.md**](file:///e:/Code%20Tresure/File%20manager/docs/security/PRIVACY_SECURITY.md) | Zero-Cloud Privacy Guarantee, biometric data isolation, data classification matrix, and in-flight modification guards. |

---

### 6. Development & Workflows (`docs/development/`)
| Document | Description |
| :--- | :--- |
| [**CONTRIBUTING.md**](file:///e:/Code%20Tresure/File%20manager/docs/development/CONTRIBUTING.md) | Contribution standards, code style guidelines, Git commit conventions, and SemVer release workflow. |
| [**SETUP_WINDOWS.md**](file:///e:/Code%20Tresure/File%20manager/docs/development/SETUP_WINDOWS.md) | Step-by-step Windows 10/11 environment setup, Python environment configuration, and native module builds. |
| [**GSD_STYLE.md**](file:///e:/Code%20Tresure/File%20manager/docs/development/GSD_STYLE.md) | Comprehensive reference for Get Shit Done (GSD) workflow design and prompt engineering. |
| [**TASKS.md**](file:///e:/Code%20Tresure/File%20manager/docs/development/TASKS.md) | Actionable engineering task registry synchronized with codebase implementation status. |

---

### 7. Feature Deep-Dives (`docs/features/`)
| Document | Description |
| :--- | :--- |
| [**AI_PIPELINE.md**](file:///e:/Code%20Tresure/File%20manager/docs/features/AI_PIPELINE.md) | On-device AI inference engine, line-delimited JSON-RPC communication, and face clustering algorithms. |
| [**SEARCH_DUPLICATES.md**](file:///e:/Code%20Tresure/File%20manager/docs/features/SEARCH_DUPLICATES.md) | SQLite FTS5 search indexer, SHA-256 exact deduplication, and perceptual difference hashing (`dHash`). |
| [**UI_UX_SPEC.md**](file:///e:/Code%20Tresure/File%20manager/docs/features/UI_UX_SPEC.md) | Cinematic Windows 11 dark theme design tokens, glassmorphism specs, and 12-page view layouts. |

---

### 8. Project Policies & Changelog
- [**MODEL_AND_DEPENDENCY_LICENSES.md**](file:///e:/Code%20Tresure/File%20manager/docs/MODEL_AND_DEPENDENCY_LICENSES.md) — Open source dependency licenses and model weight compliance.
- [**CHANGELOG.md**](file:///e:/Code%20Tresure/File%20manager/CHANGELOG.md) — Authoritative chronological release and version change history.
- [**PROJECT_RULES.md**](file:///e:/Code%20Tresure/File%20manager/PROJECT_RULES.md) — Canonical rules and protocols for AI pair-programming and development.
