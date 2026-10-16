#!/usr/bin/env python3
"""
Nexora — Offline AI Model Bundling & Integrity Verification Tool
Downloads and verifies official OpenCV Zoo permissive AI models into models/
Ensures 100% offline bundling for Windows installer release.
"""

import os
import sys
import json
import hashlib
import urllib.request

MODELS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models")
LABELS_DIR = os.path.join(MODELS_DIR, "labels")

MODEL_SPECS = [
    {
        "name": "YuNet Face Detector",
        "task": "face_detection",
        "version": "2023mar",
        "filename": "face_detection_yunet_2023mar.onnx",
        "url": "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
        "sha256": "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
        "license": "MIT",
        "source": "https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet",
        "required": True,
        "runtime": "cv2.FaceDetectorYN / cv2.dnn",
        "description": "Millisecond-level face detector outputting bounding boxes and 5 facial landmarks (eyes, nose, mouth corners)."
    },
    {
        "name": "SFace Face Recognizer",
        "task": "face_recognition",
        "version": "2021dec_int8",
        "filename": "face_recognition_sface_2021dec_int8.onnx",
        "url": "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec_int8.onnx",
        "sha256": "2b0e941e6f16cc048c20aee0c8e31f569118f65d702914540f7bfdc14048d78a",
        "license": "Apache-2.0",
        "source": "https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface",
        "required": True,
        "runtime": "cv2.FaceRecognizerSF / cv2.dnn",
        "description": "Robust deep biometric face feature extractor generating 128-dimensional cosine embeddings with 99.4% LFW accuracy."
    },
    {
        "name": "MobileNetV2 Classifier",
        "task": "image_classification",
        "version": "2022apr_int8",
        "filename": "image_classification_mobilenetv2_2022apr_int8.onnx",
        "url": "https://github.com/opencv/opencv_zoo/raw/main/models/image_classification_mobilenet/image_classification_mobilenetv2_2022apr_int8.onnx",
        "sha256": "cc028fe6cae7bc11a4ff53cfc9b79c920e8be65ce33a904ec3e2a8f66d77f95f",
        "license": "Apache-2.0",
        "source": "https://github.com/opencv/opencv_zoo/tree/main/models/image_classification_mobilenet",
        "required": False,
        "runtime": "cv2.dnn",
        "description": "Quantized lightweight vision classifier categorizing scene content across 1,000 ImageNet semantic classes."
    },
    {
        "name": "PP-OCRv3 Text Detector",
        "task": "text_detection",
        "version": "2023may_int8",
        "filename": "text_detection_en_ppocrv3_2023may_int8.onnx",
        "url": "https://github.com/opencv/opencv_zoo/raw/main/models/text_detection_ppocr/text_detection_en_ppocrv3_2023may_int8.onnx",
        "sha256": "5700c6d43bfc022b4bf2905cd0bac1a3d7dc41f4f954e9c171314ae9b4f0e41a",
        "license": "Apache-2.0",
        "source": "https://github.com/opencv/opencv_zoo/tree/main/models/text_detection_ppocr",
        "required": False,
        "runtime": "cv2.dnn.TextDetectionModel_DB / cv2.dnn",
        "description": "High-efficiency DBNet-based optical text segmenter detecting text bounding boxes in images and documents."
    },
    {
        "name": "CRNN Text Recognizer",
        "task": "text_recognition",
        "version": "2022oct_int8",
        "filename": "text_recognition_CRNN_EN_2022oct_int8.onnx",
        "url": "https://github.com/opencv/opencv_zoo/raw/main/models/text_recognition_crnn/text_recognition_CRNN_EN_2022oct_int8.onnx",
        "sha256": "94117b4c2652337b3f1aef81b2ec15a74e97973b1c58f743e86380b95b95ffa2",
        "license": "Apache-2.0",
        "source": "https://github.com/opencv/opencv_zoo/tree/main/models/text_recognition_crnn",
        "required": False,
        "runtime": "cv2.dnn.TextRecognitionModel / cv2.dnn",
        "description": "Convolutional Recurrent Neural Network sequence reader transcribing detected text crops to UTF-8 strings."
    }
]

def download_file(url: str, dest_path: str, expected_sha256: str) -> None:
    if os.path.exists(dest_path):
        with open(dest_path, "rb") as f:
            current_hash = hashlib.sha256(f.read()).hexdigest()
        if current_hash.lower() == expected_sha256.lower():
            print(f"  [OK] Already downloaded and verified: {os.path.basename(dest_path)}")
            return
        else:
            print(f"  [WARN] Checksum mismatch for {dest_path}, re-downloading...")

    print(f"  [DOWNLOADING] {url} -> {os.path.basename(dest_path)}...")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
    with urllib.request.urlopen(req, timeout=60) as resp, open(dest_path, "wb") as out_file:
        data = resp.read()
        out_file.write(data)

    calc_hash = hashlib.sha256(data).hexdigest()
    if calc_hash.lower() != expected_sha256.lower():
        raise ValueError(f"Integrity check failed for {dest_path}!\nExpected: {expected_sha256}\nGot:      {calc_hash}")
    print(f"  [VERIFIED] Size: {len(data)} bytes, SHA-256: {calc_hash}")


def main():
    os.makedirs(MODELS_DIR, exist_ok=True)
    os.makedirs(LABELS_DIR, exist_ok=True)

    print("=== Nexora Offline AI Model Bundling Tool ===")
    manifest_entries = []

    for spec in MODEL_SPECS:
        target_path = os.path.join(MODELS_DIR, spec["filename"])
        download_file(spec["url"], target_path, spec["sha256"])
        
        file_size = os.path.getsize(target_path)
        manifest_entries.append({
            "name": spec["name"],
            "task": spec["task"],
            "version": spec["version"],
            "filename": spec["filename"],
            "sha256": spec["sha256"],
            "size_bytes": file_size,
            "license": spec["license"],
            "source": spec["source"],
            "required": spec["required"],
            "runtime": spec["runtime"],
            "description": spec["description"],
            "offline_ready": True
        })

    # Save CRNN English alphabet
    crnn_alpha_path = os.path.join(LABELS_DIR, "crnn_alphabet.txt")
    if not os.path.exists(crnn_alpha_path):
        alpha = "0123456789abcdefghijklmnopqrstuvwxyz"
        with open(crnn_alpha_path, "w", encoding="utf-8") as f:
            f.write("\n".join(list(alpha)))
        print(f"  [CREATED] {crnn_alpha_path}")

    # Write authoritative manifest.json
    manifest_path = os.path.join(MODELS_DIR, "manifest.json")
    manifest_data = {
        "version": "1.0.0",
        "description": "Nexora Offline AI Model Manifest & Cryptographic Integrity Registry",
        "models_dir": "models",
        "offline_guarantee": "100% On-Device Local Processing. Zero Cloud APIs. Zero Remote Downloads.",
        "models": manifest_entries
    }
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest_data, f, indent=2)

    print(f"\n[SUCCESS] Manifest generated at {manifest_path}")
    print(f"Total bundled models: {len(manifest_entries)}")

if __name__ == "__main__":
    main()
