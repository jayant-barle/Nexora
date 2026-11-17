"""Download OpenCV Zoo face detection and recognition ONNX models and verify SHA-256 hashes."""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path
import urllib.request

MODELS_DIR = Path(__file__).resolve().parent.parent / "models"

# URLs from official opencv_zoo repository
MODELS = {
    "face_detection_yunet_2023mar.onnx": {
        "url": "https://github.com/opencv/opencv_zoo/raw/refs/heads/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
        "sha256": "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
    },
    "face_recognition_sface_2021dec.onnx": {
        "url": "https://github.com/opencv/opencv_zoo/raw/refs/heads/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx",
        "sha256": "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
    },
}


def compute_sha256(filepath: Path) -> str:
    """Compute SHA-256 checksum of a file."""
    hasher = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(1024 * 1024):
            hasher.update(chunk)
    return hasher.hexdigest()


def download_file(url: str, dest_path: Path) -> None:
    """Download a file with user-agent header to handle redirects."""
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Nexora/0.4.0"},
    )
    with urllib.request.urlopen(req) as resp, open(dest_path, "wb") as out_file:
        while chunk := resp.read(1024 * 1024):
            out_file.write(chunk)


def download_models(force: bool = False) -> dict[str, str]:
    """Download and verify models. Returns dict of {filename: sha256}."""
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    results = {}

    for filename, info in MODELS.items():
        dest = MODELS_DIR / filename
        expected_hash = info.get("sha256")

        if dest.exists() and not force:
            actual_hash = compute_sha256(dest)
            if not expected_hash or actual_hash == expected_hash:
                print(f"[OK] {filename} already exists (SHA-256: {actual_hash})")
                results[filename] = actual_hash
                continue
            else:
                print(f"[WARN] Hash mismatch for {filename}, re-downloading...")

        print(f"Downloading {filename} from {info['url']}...")
        download_file(info["url"], dest)
        actual_hash = compute_sha256(dest)
        print(f"Downloaded {filename}: SHA-256 {actual_hash}")

        if expected_hash and actual_hash != expected_hash:
            raise ValueError(f"Checksum mismatch for {filename}: expected {expected_hash}, got {actual_hash}")

        results[filename] = actual_hash

    return results


if __name__ == "__main__":
    try:
        hashes = download_models()
        print("\nAll models ready:")
        for name, sha in hashes.items():
            print(f"  {name}: {sha}")
    except Exception as e:
        print(f"Error downloading models: {e}", file=sys.stderr)
        sys.exit(1)
