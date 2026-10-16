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

## 5. Bundled Offline Neural Models & Weights Governance

Nexora bundles verified on-device neural network models directly into its release package (`resources/models/`). Every model is governed by a permissive open-source license (MIT or Apache-2.0) and is verified against cryptographic SHA-256 checksums before loading:

| Model Name | Task | Version | File & Size | SHA-256 Checksum | License | Upstream Source |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **YuNet** | Face Detection | `2023mar` | `face_detection_yunet_2023mar.onnx`<br>(232.5 KB) | `8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4` | **MIT** | [ShiqiYu/libfacedetection](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet) |
| **SFace** | Face Recognition / Embeddings | `2021dec_int8` | `face_recognition_sface_2021dec_int8.onnx`<br>(9.89 MB) | `2b0e941e6f16cc048c20aee0c8e31f569118f65d702914540f7bfdc14048d78a` | **Apache-2.0** | [zhongyy/SFace](https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface) |
| **MobileNetV2** | Scene & Image Classification | `2022apr_int8` | `image_classification_mobilenetv2_2022apr_int8.onnx`<br>(3.65 MB) | `cc028fe6cae7bc11a4ff53cfc9b79c920e8be65ce33a904ec3e2a8f66d77f95f` | **Apache-2.0** | [OpenCV Zoo](https://github.com/opencv/opencv_zoo/tree/main/models/image_classification_mobilenet) |
| **PP-OCRv3** | Text Detection | `2023may_int8` | `text_detection_en_ppocrv3_2023may_int8.onnx`<br>(705.0 KB) | `5700c6d43bfc022b4bf2905cd0bac1a3d7dc41f4f954e9c171314ae9b4f0e41a` | **Apache-2.0** | [PaddlePaddle / OpenCV Zoo](https://github.com/opencv/opencv_zoo/tree/main/models/text_detection_ppocr) |
| **CRNN** | Text Recognition / OCR | `2022oct_int8` | `text_recognition_CRNN_EN_2022oct_int8.onnx`<br>(16.37 MB) | `94117b4c2652337b3f1aef81b2ec15a74e97973b1c58f743e86380b95b95ffa2` | **Apache-2.0** | [OpenCV Zoo](https://github.com/opencv/opencv_zoo/tree/main/models/text_recognition_crnn) |

---

## 6. Strict Offline Privacy & Data Sovereignty Guarantee

1. **Zero Cloud Inference**: 100% of face detection, recognition, clustering, classification, and OCR is performed on-device via OpenCV's native C++ DNN engine.
2. **Zero Remote Downloads**: All model weights are bundled directly into the installation package. The application never attempts to download models, dependencies, or updates in the background.
3. **Biometric Vector Sovereignty**: Biometric vector embeddings (128-dimensional floating point arrays) are stored exclusively in the user's local SQLite database (`%APPDATA%\Nexora\nexora.db`) and are never transmitted off the user's computer.
4. **Offline Operation Tested**: Nexora functions with full capabilities when the host system is completely disconnected from the network.
