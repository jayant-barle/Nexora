"""Face detection using OpenCV YuNet model with 1280px normalization, quality filtering, and rotation fallback."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any
import numpy as np
import cv2
from PIL import Image, ImageOps
import pillow_heif  # registers HEIF opener if installed

SCORE_THRESHOLD = 0.85  # Raised to 0.85 for high precision and fewer false positives
MIN_FACE_SIZE = 48      # Minimum 48px width and height in 1280px analysis image
MAX_ASPECT_RATIO = 2.5  # Drop boxes more than 2.5x taller than wide or wider than tall
TARGET_SIZE = 1280      # Longest side normalized to 1280px
NMS_THRESHOLD = 0.3     # Non-maximum suppression threshold


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
_detector_score: float | None = None


def get_detector(
    model_path: Path | None = None,
    score_threshold: float = SCORE_THRESHOLD,
) -> cv2.FaceDetectorYN | None:
    """Get or initialize the FaceDetectorYN singleton."""
    global _detector, _detector_path, _detector_score
    path = model_path or get_default_yunet_path()

    if _detector is not None and _detector_path == path and _detector_score == score_threshold:
        return _detector

    if not path.exists():
        return None

    try:
        _detector = cv2.FaceDetectorYN.create(
            model=str(path),
            config="",
            input_size=(320, 320),
            score_threshold=score_threshold,
            nms_threshold=NMS_THRESHOLD,
            top_k=5000,
        )
        _detector_path = path
        _detector_score = score_threshold
        return _detector
    except Exception:
        return None


def read_image_bgr(image_path: Path | str | np.ndarray, apply_exif_transpose: bool = True) -> np.ndarray | None:
    """Safely read an image from disk or accept numpy array as a BGR numpy array.
    
    Applies EXIF orientation normalization (ImageOps.exif_transpose) by default for disk images.
    Supports JPEG, PNG, WEBP, and HEIC on Windows without raising.
    """
    if isinstance(image_path, np.ndarray):
        return image_path
    try:
        with Image.open(image_path) as pil_img:
            if apply_exif_transpose:
                try:
                    pil_img = ImageOps.exif_transpose(pil_img) or pil_img
                except Exception:
                    pass
            rgb = pil_img.convert("RGB")
            arr = np.array(rgb)
            return cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
    except Exception:
        return None


def _detect_raw(detector: cv2.FaceDetectorYN, img_bgr: np.ndarray) -> list[np.ndarray]:
    """Run raw detector on an image array."""
    h, w = img_bgr.shape[:2]
    if h <= 0 or w <= 0:
        return []
    detector.setInputSize((w, h))
    _, faces = detector.detect(img_bgr)
    if faces is None or len(faces) == 0:
        return []
    return [face for face in faces]


def passes_quality_filter(
    face: np.ndarray,
    min_size: int = MIN_FACE_SIZE,
    max_aspect: float = MAX_ASPECT_RATIO,
    scale_to_1280: float = 1.0,
) -> bool:
    """Filter face by minimum size (48px) and aspect ratio (2.5) measured on the 1280-pixel analysis image."""
    w = float(face[2]) * scale_to_1280
    h = float(face[3]) * scale_to_1280
    if w < min_size or h < min_size:
        return False
    if w <= 0 or h <= 0:
        return False
    if h > max_aspect * w or w > max_aspect * h:
        return False
    return True
    w = float(face[2])
    h = float(face[3])
    if w < min_size or h < min_size:
        return False
    if w <= 0 or h <= 0:
        return False
    if h > max_aspect * w or w > max_aspect * h:
        return False
    return True


def _invert_scale(faces: list[np.ndarray], scale_x: float, scale_y: float) -> list[np.ndarray]:
    """Scale face bounding boxes and landmarks back to original image space."""
    if scale_x == 1.0 and scale_y == 1.0:
        return faces
    res = []
    for f in faces:
        c = f.copy()
        c[0] /= scale_x
        c[1] /= scale_y
        c[2] /= scale_x
        c[3] /= scale_y
        c[4:14:2] /= scale_x
        c[5:14:2] /= scale_y
        res.append(c)
    return res


def _invert_rot90(faces: list[np.ndarray], orig_h: int) -> list[np.ndarray]:
    """Map face coordinates from 90° clockwise rotation back to original upright space."""
    res = []
    for f in faces:
        c = f.copy()
        x_rot, y_rot, w_rot, h_rot = f[0], f[1], f[2], f[3]
        c[0] = y_rot
        c[1] = orig_h - 1 - x_rot - w_rot
        c[2] = h_rot
        c[3] = w_rot

        for i in range(5):
            lx_rot = f[4 + 2 * i]
            ly_rot = f[5 + 2 * i]
            c[4 + 2 * i] = ly_rot
            c[5 + 2 * i] = orig_h - 1 - lx_rot
        res.append(c)
    return res


def _invert_rot270(faces: list[np.ndarray], orig_w: int) -> list[np.ndarray]:
    """Map face coordinates from 270° clockwise (90° CCW) rotation back to original upright space."""
    res = []
    for f in faces:
        c = f.copy()
        x_rot, y_rot, w_rot, h_rot = f[0], f[1], f[2], f[3]
        c[0] = orig_w - 1 - y_rot - h_rot
        c[1] = x_rot
        c[2] = h_rot
        c[3] = w_rot

        for i in range(5):
            lx_rot = f[4 + 2 * i]
            ly_rot = f[5 + 2 * i]
            c[4 + 2 * i] = orig_w - 1 - ly_rot
            c[5 + 2 * i] = lx_rot
        res.append(c)
    return res


def get_face_box_and_score(face: np.ndarray) -> dict[str, Any]:
    """Extract face box width, height (in original image pixels), and detection score from a face array."""
    w = int(round(float(face[2]))) if len(face) > 2 else 0
    h = int(round(float(face[3]))) if len(face) > 3 else 0
    score = float(face[14]) if len(face) > 14 else 1.0
    return {
        "box_w": w,
        "box_h": h,
        "det_score": score,
    }


def detect_faces(
    image_path: Path | str | np.ndarray,
    model_path: Path | None = None,
    score_threshold: float = SCORE_THRESHOLD,
    min_face_size: int = MIN_FACE_SIZE,
    max_aspect: float = MAX_ASPECT_RATIO,
) -> list[np.ndarray]:
    """Detect faces with 1280px normalization, quality filtering, and 90°/270° rotation retry.
    
    1. EXIF orientation applied first.
    2. Longest side scaled to 1280px (with upscale for small images).
    3. Pass 1: Upright 1280px image (score >= 0.85, size >= 48px on 1280px, aspect ratio <= 2.5).
    4. Pass 2: If no face found, rotation fallback: try 90 and 270 degrees.
    5. Pass 3: Small image fallback at native / 640px space.
    
    Returns a list of face arrays in original image coordinate space. Never raises.
    """
    try:
        img = read_image_bgr(image_path, apply_exif_transpose=True)
        if img is None:
            return []

        orig_h, orig_w = img.shape[:2]
        if orig_h <= 0 or orig_w <= 0:
            return []

        detector = get_detector(model_path, score_threshold=score_threshold)
        if detector is None:
            return []

        longest = max(orig_h, orig_w)

        # Resize so longest side is 1280px
        if longest != TARGET_SIZE and longest > 0:
            scale = TARGET_SIZE / float(longest)
            w_target = int(round(orig_w * scale))
            h_target = int(round(orig_h * scale))
            img_target = cv2.resize(
                img,
                (w_target, h_target),
                interpolation=cv2.INTER_AREA if scale < 1.0 else cv2.INTER_LINEAR,
            )
            sx = w_target / float(orig_w)
            sy = h_target / float(orig_h)
        else:
            img_target = img
            w_target, h_target = orig_w, orig_h
            sx = 1.0
            sy = 1.0

        # Pass 1: Upright 1280px image
        raw = _detect_raw(detector, img_target)
        valid_faces = [f for f in raw if passes_quality_filter(f, min_face_size, max_aspect)]
        if valid_faces:
            return _invert_scale(valid_faces, sx, sy)

        # Pass 2: If no face found, try rotation fallback: 90 and 270 degrees
        rot90 = cv2.rotate(img_target, cv2.ROTATE_90_CLOCKWISE)
        raw_90 = _detect_raw(detector, rot90)
        valid_90 = [f for f in raw_90 if passes_quality_filter(f, min_face_size, max_aspect)]
        if valid_90:
            inv_90 = _invert_rot90(valid_90, img_target.shape[0])
            return _invert_scale(inv_90, sx, sy)

        rot270 = cv2.rotate(img_target, cv2.ROTATE_90_COUNTERCLOCKWISE)
        raw_270 = _detect_raw(detector, rot270)
        valid_270 = [f for f in raw_270 if passes_quality_filter(f, min_face_size, max_aspect)]
        if valid_270:
            inv_270 = _invert_rot270(valid_270, img_target.shape[1])
            return _invert_scale(inv_270, sx, sy)

        # Pass 3: If original is smaller than 1280px, try at original resolution
        if longest < TARGET_SIZE and longest > 0:
            scale_to_1280 = TARGET_SIZE / float(longest)
            raw_orig = _detect_raw(detector, img)
            valid_orig = [f for f in raw_orig if passes_quality_filter(f, min_face_size, max_aspect, scale_to_1280)]
            if valid_orig:
                return valid_orig

            r90_orig = cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)
            raw_r90 = _detect_raw(detector, r90_orig)
            valid_r90 = [f for f in raw_r90 if passes_quality_filter(f, min_face_size, max_aspect, scale_to_1280)]
            if valid_r90:
                return _invert_rot90(valid_r90, orig_h)

            r270_orig = cv2.rotate(img, cv2.ROTATE_90_COUNTERCLOCKWISE)
            raw_r270 = _detect_raw(detector, r270_orig)
            valid_r270 = [f for f in raw_r270 if passes_quality_filter(f, min_face_size, max_aspect, scale_to_1280)]
            if valid_r270:
                return _invert_rot270(valid_r270, orig_w)

        return []
    except Exception:
        return []
