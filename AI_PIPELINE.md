# Local AI Pipeline & Inference Architecture

## Product: Nexora — AI File Manager
**Tagline:** *"Your files. Your intelligence. Your control."*  
**Platform:** Windows 11 Desktop  
**Canonical Version:** `0.1.0`

---

## 1. Local-Only Processing Principle

Nexora's AI capabilities operate under a strict **Zero-Cloud Guarantee**:
- All neural inference, facial detection, vector embedding, perceptual hashing, and metadata parsing execute strictly on the local CPU or available on-device GPU acceleration.
- No file buffers, raw images, embeddings, metadata, or telemetry are transmitted outside the user's personal machine.
- The AI subsystem operates reliably without an active internet connection.

---

## 2. Subprocess Worker Architecture

To safeguard the responsiveness of the Electron desktop shell and prevent memory leaks or Python GIL stalls from degrading UI frame rates, Nexora isolates all heavy computation in a dedicated Python worker subprocess.

```
+--------------------------------------------------------------------------+
|                     Electron Main Process (Node.js)                      |
|                                                                          |
|  +----------------------+             +-------------------------------+  |
|  |     Job Manager      |             |     Database (SQLite WAL)     |  |
|  +----------+-----------+             +---------------+---------------+  |
|             |                                         ^                  |
|             | JSON-RPC Request                        | Write results    |
|             v                                         |                  |
|  +----------+-----------------------------------------+---------------+  |
|  |                   Python Worker Subprocess                         |  |
|  |                   (ai-worker/src/main.py)                          |  |
|  |                                                                    |  |
|  |   [stdin]  --> Line-delimited JSON-RPC Server                      |  |
|  |   [stdout] <-- High-throughput Line-delimited JSON-RPC Responses   |  |
|  |                                                                    |  |
|  |   +-------------------+  +-------------------+  +---------------+  |  |
|  |   | Hashes & dHash    |  | EXIF & GPS Parser |  | Face Detector |  |  |
|  |   +-------------------+  +-------------------+  +---------------+  |  |
|  |   +-------------------+  +-------------------+                     |  |
|  |   | Cosine Clusterer  |  | Thumbnail Lanczos |                     |  |
|  |   +-------------------+  +-------------------+                     |  |
|  +--------------------------------------------------------------------+  |
+--------------------------------------------------------------------------+
```

### JSON-RPC Protocol Specification

Communication between Node.js and Python occurs over `stdin` and `stdout` using newline-delimited JSON packets.

#### Request Format
```json
{
  "id": "job-550e8400-e29b-41d4-a716-446655440000",
  "action": "compute_hashes",
  "params": {
    "file_path": "C:\\Users\\User\\Pictures\\Vacation\\DSC_0012.JPG"
  }
}
```

#### Success Response Format
```json
{
  "id": "job-550e8400-e29b-41d4-a716-446655440000",
  "status": "ok",
  "result": {
    "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "md5": "d41d8cd98f00b204e9800998ecf8427e",
    "size_bytes": 4829104,
    "phash": "b4f2c09191e4b8a2"
  }
}
```

#### Error Response Format
```json
{
  "id": "job-550e8400-e29b-41d4-a716-446655440000",
  "status": "error",
  "message": "File not found: C:\\path\\to\\file.jpg",
  "traceback": "Traceback (most recent call last):\n..."
}
```

---

## 3. Pipeline Stages & Algorithms

### 3.1. Cryptographic & Perceptual Hashing (`compute_hashes`)
- **SHA-256 & MD5**: Streamed in 64 KB buffers using Python's native `hashlib` to guarantee low memory overhead even on multi-gigabyte video files.
- **Perceptual Difference Hash (`dHash`)**:
  1. Input image converted to 8-bit grayscale (`L` mode).
  2. Resampled to 9x8 pixels using high-quality Lanczos anti-aliasing.
  3. Computes 64 horizontal differences: `pixel[col] > pixel[col + 1]`.
  4. Encodes 64 boolean comparison flags into a 16-character hexadecimal string.
  5. Allows instant Hamming distance comparisons in SQLite to detect visually identical photos saved under different compressions or file formats.

### 3.2. EXIF & Geolocation Extraction (`extract_metadata`)
- **Temporal Alignment**:
  - Extracts EXIF `DateTimeOriginal` or `DateTime` headers.
  - Normalizes camera timestamps (`YYYY:MM:DD HH:MM:SS`) into ISO 8601 strings (`YYYY-MM-DDTHH:MM:SS`) used by `TimelinePage.tsx`.
- **Camera Identification**: Reads EXIF `Make` and `Model` tags.
- **GPS Coordinates**:
  - Parses EXIF tag 34853 (`GPSInfo`).
  - Converts Degrees, Minutes, Seconds (`DMS`) tuples into signed decimal degrees:
    $$\text{Degrees} = \text{deg} + \frac{\text{min}}{60} + \frac{\text{sec}}{3600}$$
  - Applies hemisphere sign: Southern (`S`) and Western (`W`) coordinates converted to negative values.

### 3.3. Facial Recognition & Vector Clustering (`detect_faces` & `cluster_faces`)
- **Face Detection**:
  - Detects human faces in still images and video keyframes.
  - Outputs normalized bounding box coordinates: `[x_min, y_min, width, height]` scaled `[0.0, 1.0]` relative to photo dimensions.
  - Extracts 128-dimensional or 512-dimensional facial embedding vectors.
- **Cosine Distance Clustering**:
  - Compares embedding pairs using cosine distance metric:
    $$D_C(u, v) = 1 - \frac{u \cdot v}{\|u\|_2 \|v\|_2}$$
  - Aggregates detected faces into identity clusters when $D_C < \text{threshold}$ (default: `0.60`).
  - Clustered identities are populated into `face_clusters` and linked to `people` in the database.

### 3.4. Thumbnail Generation (`generate_thumbnail`)
- Downscales full-resolution media to uniform 256x256 bounding boxes.
- Preserves aspect ratio using Lanczos resampling.
- Automatically converts RGBA/palette modes to RGB for standard JPEG output.
- Outputs saved to `%APPDATA%\nexora\thumbnails\` with 85% quality factor for optimal speed-to-fidelity balance.

---

## 4. Graceful Degradation & Fallbacks

Nexora adapts dynamically to the Python environment available on the host machine:

| Capability | With PIL / NumPy / OpenCV | Without External Packages (Pure Python) |
| :--- | :--- | :--- |
| **SHA-256 / MD5** | Full native speed (`hashlib`) | Full native speed (`hashlib`) |
| **Perceptual dHash** | Enabled (via Pillow) | Gracefully skipped (`phash = null`) |
| **EXIF & GPS** | Full extraction (via Pillow) | Fallback to filesystem `mtime` / `ctime` |
| **Face Clustering** | Vectorized cosine clustering | Pure Python list comprehension clustering |
| **Thumbnails** | 256px Lanczos JPEG generation | Electron native thumbnail generation |

---

## 5. Worker Lifecycle & Fault Tolerance

1. **Auto-Restart on Crash**: If the Python worker terminates unexpectedly (e.g., out-of-memory on an extreme 100-megapixel RAW file), Electron captures the exit code, logs the crash in `job_errors`, and immediately spawns a fresh worker instance.
2. **Idle State Management**: When no indexing or analysis jobs are queued, the worker enters an unbuffered blocking read on `sys.stdin`, consuming 0% CPU cycles.
3. **Cancellation Support**: Long-running jobs can be cancelled via IPC (`jobs:cancel`), which sends a cooperative cancellation token or terminates the subprocess if unresponsive.
