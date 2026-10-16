# Windows 11 Setup & Environment Guide — Nexora

## Product: Nexora — AI File Manager
**Version:** 0.5.0  
**Target OS:** Windows 11 (64-bit, Build 22000+)  

---

## 1. Prerequisites

Before installing and running Nexora, ensure your development machine has the following dependencies installed:

| Tool | Minimum Version | Recommended Version | Verification Command |
| :--- | :--- | :--- | :--- |
| **Node.js** | 20.x LTS | 22.x LTS | `node -v` |
| **npm** | 10.x | 10.x+ | `npm -v` |
| **Python** | 3.10+ | 3.12+ / 3.14+ | `python --version` |
| **OpenCV Python** | 4.x / 5.x | `opencv-python 5.0+` | `python -c "import cv2; print(cv2.__version__)"` |
| **NumPy** | 1.24+ | `numpy 2.x` | `python -c "import numpy; print(numpy.__version__)"` |

---

## 2. Installation & Build Steps

### Step 1: Clone Repository
```powershell
git clone https://github.com/jayant-barle/Nexora.git
cd Nexora
```

### Step 2: Install Node Dependencies
```powershell
npm install
```

### Step 3: Compile / Rebuild Native Addons
`better-sqlite3` must match the Electron Node ABI (`NODE_MODULE_VERSION 130` for Electron 33):
```powershell
npx @electron/rebuild -f -w better-sqlite3
```

### Step 4: Setup Python AI Dependencies (Optional / Local AI Features)
Ensure OpenCV and NumPy are installed in your Python environment or virtual environment:
```powershell
pip install numpy opencv-python
```
*Note: If using a virtual environment (`.venv`), Nexora automatically detects `.venv\Scripts\python.exe` or the `NEXORA_PYTHON_PATH` environment variable.*

---

## 3. Running & Packaging the Application

### Development Mode (Concurrent Renderer + Main)
Starts Vite in dev-server mode and launches Electron with live hot-reloading:
```powershell
npm run dev
```

### Type Checking
```powershell
# Validate frontend React TypeScript
npm run typecheck

# Validate backend Electron Main TypeScript
npm run typecheck:main
```

### Running Test Suite
```powershell
npm test
```

### Production Build
Compiles both Vite frontend bundle and Electron TypeScript main process into `dist/`:
```powershell
npm run build
```

### Generate Windows NSIS Installer (.exe)
Compiles production assets and generates a distributable Windows 11 `.exe` installer in `release/`:
```powershell
npm run package
```
*Installer Output:* `release/Nexora-Setup-0.5.0.exe`

### Build Unpacked Directory for Local Testing
Generates unpacked application folder for immediate execution without installing:
```powershell
npm run package:dir
```
*Executable Output:* `release/win-unpacked/Nexora.exe`

---

## 4. Hardware System Profiles & Minimum Requirements

Nexora automatically evaluates installed hardware and runtime resource pressure to configure execution limits without requiring Windows administrator privileges:

| Metric | Low Resource Profile | Balanced Profile | Performance Profile |
| :--- | :--- | :--- | :--- |
| **Target Hardware** | $\le 6$ GB RAM or $\le 4$ CPU cores | 8–16 GB RAM, 6–8 CPU cores | $\ge 16$ GB RAM, $\ge 8$ cores, dedicated GPU |
| **Max Concurrent Jobs** | 1 worker | 2 workers | 4 workers |
| **Batch Indexing Size** | 25 files / transaction | 50 files / transaction | 100 files / transaction |
| **Face Image Downscaling** | Max 1024px dimension | Max 1600px dimension | Max 1600px dimension |
| **Video Frame Sampling** | 15s keyframe interval | 5s keyframe interval | 2s keyframe interval |
| **Background AI Status** | Deferred under high load | Active in background | Full throughput + GPU acceleration |
| **Direct Video Seek** | Enabled (`cap.set`) | Enabled (`cap.set`) | Enabled (`cap.set`) |
| **Privileges Needed** | Standard user (Non-admin) | Standard user (Non-admin) | Standard user (Non-admin) |

---

## 5. Bundled Offline AI Models & Zero-Cloud Guarantee

Nexora bundles its entire suite of neural network models directly within the Windows release package. No internet connection, API keys, or post-installation model downloads are ever required.

### Model Manifest & Cryptographic Integrity

Every bundled model is located in `models/` (packaged into `resources/models/`) and verified against its SHA-256 hash prior to execution:

| Model | Purpose | Architecture | Size | SHA-256 Checksum | License |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **YuNet** | Face Detection | CNN with 5 Landmarks | 232.5 KB | `8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4` | MIT |
| **SFace** | Face Recognition | 128-d ArcFace / MobileFaceNet | 9.89 MB | `2b0e941e6f16cc048c20aee0c8e31f569118f65d702914540f7bfdc14048d78a` | Apache-2.0 |
| **MobileNetV2** | Scene Classification | Quantized MobileNetV2 (1k classes) | 3.65 MB | `cc028fe6cae7bc11a4ff53cfc9b79c920e8be65ce33a904ec3e2a8f66d77f95f` | Apache-2.0 |
| **PP-OCRv3** | Text Detection | DBNet Text Segmenter | 705.0 KB | `5700c6d43bfc022b4bf2905cd0bac1a3d7dc41f4f954e9c171314ae9b4f0e41a` | Apache-2.0 |
| **CRNN** | Text Recognition | Convolutional Recurrent Network | 16.37 MB | `94117b4c2652337b3f1aef81b2ec15a74e97973b1c58f743e86380b95b95ffa2` | Apache-2.0 |

To verify or refresh model artifacts during development:
```powershell
python scripts/download-models.py
```
