"""Face detection using OpenCV YuNet model with orientation, multi-scale, and rotation support."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any
import numpy as np
import cv2
from PIL import Image, ImageOps
import pillow_heif  # registers HEIF opener if installed

SCORE_THRESHOLD = 0.6  # Lowered from 0.8 to 0.6 for higher recall
NMS_THRESHOLD = 0.3    # Non-maximum suppression threshold
MIN_FACE_SIZE = 20     # Minimum width and height for detected face in pixels


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


def _filter_min_size(faces: list[np.ndarray], min_size: int = MIN_FACE_SIZE) -> list[np.ndarray]:
    """Filter out faces smaller than min_size in width or height."""
    return [f for f in faces if f[2] >= min_size and f[3] >= min_size]


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


def detect_faces(
    image_path: Path | str,
    model_path: Path | None = None,
    score_threshold: float = SCORE_THRESHOLD,
    min_face_size: int = MIN_FACE_SIZE,
) -> list[np.ndarray]:
    """Detect faces with orientation normalization, multi-scale, and rotation fallback.
    
    Applies the following cascade in order, stopping as soon as a face is found:
      a. EXIF orientation transposed via PIL.ImageOps.exif_transpose.
      b. Run detection at original size, then with longest side resized to 1280px if larger.
      c. If still no face, try rotated 90 and 270 degrees.
      d. If still no face and small (longest side under 640px), upscale to 640px and try.
      
    Returns a list of face arrays. Returns an empty list when no faces are found,
    the image cannot be read, or the detector is unavailable. Never raises.
    """
    try:
        # Step a & g: Open with Pillow, handle HEIC, apply EXIF orientation
        img = read_image_bgr(image_path, apply_exif_transpose=True)
        if img is None:
            return []

        orig_h, orig_w = img.shape[:2]
        if orig_h <= 0 or orig_w <= 0:
            return []

        # Step e: YuNet score threshold 0.6
        detector = get_detector(model_path, score_threshold=score_threshold)
        if detector is None:
            return []

        longest_side = max(orig_h, orig_w)

        # Step b1: Run detection at original size
        raw = _detect_raw(detector, img)
        faces = _filter_min_size(raw, min_face_size)
        if faces:
            return faces

        # Step b2: If still no face, and image is larger than 1280, resize longest side to 1280
        if longest_side > 1280:
            scale_1280 = 1280.0 / float(longest_side)
            w_1280 = int(round(orig_w * scale_1280))
            h_1280 = int(round(orig_h * scale_1280))
            img_1280 = cv2.resize(img, (w_1280, h_1280), interpolation=cv2.INTER_AREA)
            raw = _detect_raw(detector, img_1280)
            faces = _filter_min_size(raw, min_face_size)
            if faces:
                return _invert_scale(faces, w_1280 / float(orig_w), h_1280 / float(orig_h))

        # Step c1: Try rotated 90 degrees clockwise
        rot90 = cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)
        raw = _detect_raw(detector, rot90)
        faces = _filter_min_size(raw, min_face_size)
        if faces:
            return _invert_rot90(faces, orig_h)

        # Step c2: Try rotated 270 degrees clockwise (90 counter-clockwise)
        rot270 = cv2.rotate(img, cv2.ROTATE_90_COUNTERCLOCKWISE)
        raw = _detect_raw(detector, rot270)
        faces = _filter_min_size(raw, min_face_size)
        if faces:
            return _invert_rot270(faces, orig_w)

        # Step d: If small (longest side under 640), upscale to 640 and try
        if longest_side < 640:
            scale_small = 640.0 / float(longest_side)
            w_small = int(round(orig_w * scale_small))
            h_small = int(round(orig_h * scale_small))
            img_small = cv2.resize(img, (w_small, h_small), interpolation=cv2.INTER_LINEAR)
            sx = w_small / float(orig_w)
            sy = h_small / float(orig_h)

            raw = _detect_raw(detector, img_small)
            faces = _filter_min_size(raw, min_face_size)
            if faces:
                return _invert_scale(faces, sx, sy)

            r90_small = cv2.rotate(img_small, cv2.ROTATE_90_CLOCKWISE)
            raw = _detect_raw(detector, r90_small)
            faces = _filter_min_size(raw, min_face_size)
            if faces:
                inv = _invert_rot90(faces, img_small.shape[0])
                return _invert_scale(inv, sx, sy)

            r270_small = cv2.rotate(img_small, cv2.ROTATE_90_COUNTERCLOCKWISE)
            raw = _detect_raw(detector, r270_small)
            faces = _filter_min_size(raw, min_face_size)
            if faces:
                inv = _invert_rot270(faces, img_small.shape[1])
                return _invert_scale(inv, sx, sy)

        return []
    except Exception:
        return []
