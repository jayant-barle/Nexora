# Windows 11 Setup & Environment Guide — Nexora

## Product: Nexora — AI File Manager
**Version:** 0.2.0  
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

## 2. Installation Steps

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

### Step 4: Setup Python AI Dependencies
Ensure OpenCV and NumPy are installed in your Python environment:
```powershell
pip install numpy opencv-python
```

---

## 3. Running the Application

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

### Package Windows Installer (NSIS Executable)
Packages the complete Windows 11 desktop installer into `dist-electron/`:
```powershell
npm run package
```
