"""Face detection using OpenCV YuNet model."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any
import numpy as np
import cv2
from PIL import Image
import pillow_heif  # registers HEIF opener if installed


def get_default_yunet_path() -> Path:
    """Resolve path to YuNet ONNX model in dev, bundled, or frozen environment."""
    filename = "face_detection_yunet_2023mar.onnx"
    if hasattr(sys, "_MEIPASS"):
        p = Path(sys._MEIPASS) / "models" / filename
        if p.exists():
            return p
    if getattr(sys, "frozen", False):
        p = Path(sys.executable).resolve().parent / "models" / filename
        if p.exists():
            return p
    return Path(__file__).resolve().parent.parent.parent / "models" / filename


DEFAULT_YUNET_PATH = get_default_yunet_path()

_detector: cv2.FaceDetectorYN | None = None
_detector_path: Path | None = None


def get_detector(model_path: Path | None = None) -> cv2.FaceDetectorYN | None:
    """Get or initialize the FaceDetectorYN singleton."""
    global _detector, _detector_path
    path = model_path or DEFAULT_YUNET_PATH

    if _detector is not None and _detector_path == path:
        return _detector

    if not path.exists():
        return None

    try:
        # Default YuNet parameters: score threshold 0.8, nms threshold 0.3
        _detector = cv2.FaceDetectorYN.create(
            model=str(path),
            config="",
            input_size=(320, 320),
            score_threshold=0.8,
            nms_threshold=0.3,
            top_k=5000,
        )
        _detector_path = path
        return _detector
    except Exception:
        return None


def read_image_bgr(image_path: Path | str) -> np.ndarray | None:
    """Safely read an image from disk as a BGR numpy array using Pillow.
    
    Supports JPEG, PNG, WEBP, and HEIC on Windows without raising.
    """
    try:
        with Image.open(image_path) as pil_img:
            rgb = pil_img.convert("RGB")
            arr = np.array(rgb)
            return cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
    except Exception:
        return None


def detect_faces(image_path: Path | str, model_path: Path | None = None) -> list[np.ndarray]:
    """Detect faces in an image using YuNet.
    
    Returns a list of face arrays (each containing bounding box, 5 landmarks, and score).
    Returns an empty list when no faces are found, image cannot be read,
    or detector model is unavailable. Never raises to the caller.
    """
    try:
        img = read_image_bgr(image_path)
        if img is None:
            return []

        h, w = img.shape[:2]
        if h <= 0 or w <= 0:
            return []

        detector = get_detector(model_path)
        if detector is None:
            return []

        detector.setInputSize((w, h))
        _, faces = detector.detect(img)
        if faces is None or len(faces) == 0:
            return []

        return [face for face in faces]
    except Exception:
        return []
