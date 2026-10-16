# Model & Dependency Licensing Compliance

> **Nexora — AI File Manager**  
> **Product Version:** `0.5.0`  
> **Licensing Standard:** 100% Permissive Open Source (MIT, Apache 2.0, BSD, ISC)  

---

## 1. Licensing Philosophy & Legal Policy

Nexora is committed to open, permissive software engineering:
1. **Commercially Permissive Stack**: All runtime dependencies and local AI models are governed strictly by permissive open-source licenses (MIT, Apache 2.0, ISC, BSD-2-Clause, and BSD-3-Clause).
2. **Zero Copyleft Contamination**: Nexora integrates no GPL, AGPL, or restrictive copyleft components.
3. **Zero Proprietary Cloud SDKs**: No proprietary cloud AI SDKs (Google Cloud, AWS Rekognition, Azure Cognitive Services) or tracking beacons are bundled into Nexora.

---

## 2. Production Node.js Dependencies

| Component | Version | License | Direct Source | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **better-sqlite3** | `^11.6.0` | MIT | [WiseLibs/better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | Embedded SQLite 3 database driver with WAL mode and FTS5 support |
| **chokidar** | `^4.0.3` | MIT | [paulmillr/chokidar](https://github.com/paulmillr/chokidar) | Native Windows filesystem directory change event monitor |
| **electron** | `^33.2.1` | MIT | [electron/electron](https://github.com/electron/electron) | Chromium and Node.js desktop application container |
| **electron-store** | `^10.0.0` | MIT | [sindresorhus/electron-store](https://github.com/sindresorhus/electron-store) | Lightweight persistent JSON configuration store |
| **exif-reader** | `^2.0.1` | MIT | [bwindsor/exif-reader](https://github.com/bwindsor/exif-reader) | Binary EXIF header reader and camera tag extractor |
| **sharp** | `^0.33.5` | Apache-2.0 | [lovell/sharp](https://github.com/lovell/sharp) | High-speed libvips image resize and thumbnail generation |
| **uuid** | `^10.0.0` | MIT | [uuidjs/uuid](https://github.com/uuidjs/uuid) | RFC4122 cryptographic UUID generation for database keys |
| **xxhash-wasm** | `^1.1.0` | MIT | [jungomi/xxhash-wasm](https://github.com/jungomi/xxhash-wasm) | WebAssembly-accelerated rapid change detection hash |

---

## 3. Frontend & UI Dependencies

| Component | Version | License | Direct Source | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **react** | `^18.3.1` | MIT | [facebook/react](https://github.com/facebook/react) | UI component rendering engine |
| **react-dom** | `^18.3.1` | MIT | [facebook/react](https://github.com/facebook/react) | React DOM binding for Chromium |
| **react-router-dom** | `^7.0.2` | MIT | [remix-run/react-router](https://github.com/remix-run/react-router) | Single-page application route management |
| **zustand** | `^5.0.2` | MIT | [pmndrs/zustand](https://github.com/pmndrs/zustand) | Lightweight, scoped state management stores |

---

## 4. Local AI Subprocess & Python Dependencies

| Component | Version | License | Direct Source | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **opencv-python** | `^4.8.0` | Apache-2.0 | [opencv/opencv](https://github.com/opencv/opencv) | Computer vision, video frame decoding, face detection |
| **numpy** | `^1.24.0` | BSD-3-Clause | [numpy/numpy](https://github.com/numpy/numpy) | High-performance matrix mathematics and vector distance computations |
| **Pillow** | `^10.0.0` | MIT-CMU | [python-pillow/Pillow](https://github.com/python-pillow/Pillow) | Image loading, perceptual difference hashing (`dHash`) |

---

## 5. Model Architecture & Weights Governance

Nexora utilizes on-device neural algorithms that comply with permissive distribution:
- **Haar Cascade / OpenCV DNN Models**: Governed by the Apache-2.0 license.
- **Biometric Vector Embeddings**: Embeddings generated locally are mathematical feature vectors derived from user media and stored exclusively in the user's local `%APPDATA%\nexora\nexora.db` database.
- **Data Sovereignty Guarantee**: No model training data or inference vectors are sent to any external server.
