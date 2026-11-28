"""Face recognition and embedding using OpenCV SFace model."""

from __future__ import annotations

import sys
from pathlib import Path
import numpy as np
import cv2

from nexora.faces.detect import read_image_bgr


def get_default_sface_path() -> Path:
    """Resolve path to SFace ONNX model in dev, bundled, or frozen environment."""
    filename = "face_recognition_sface_2021dec.onnx"
    if hasattr(sys, "_MEIPASS"):
        p = Path(sys._MEIPASS) / "models" / filename
        if p.exists():
            return p
    if getattr(sys, "frozen", False):
        p = Path(sys.executable).resolve().parent / "models" / filename
        if p.exists():
            return p
    return Path(__file__).resolve().parent.parent.parent / "models" / filename


DEFAULT_SFACE_PATH = get_default_sface_path()
DEFAULT_THRESHOLD = 0.363  # OpenCV recommended cosine threshold for SFace (unmeasured default, owner review pending)

_recognizer: cv2.FaceRecognizerSF | None = None
_recognizer_path: Path | None = None


def get_recognizer(model_path: Path | None = None) -> cv2.FaceRecognizerSF | None:
    """Get or initialize the FaceRecognizerSF singleton."""
    global _recognizer, _recognizer_path
    path = model_path or DEFAULT_SFACE_PATH

    if _recognizer is not None and _recognizer_path == path:
        return _recognizer

    if not path.exists():
        return None

    try:
        _recognizer = cv2.FaceRecognizerSF.create(model=str(path), config="")
        _recognizer_path = path
        return _recognizer
    except Exception:
        return None


def align_and_crop(image: np.ndarray | Path | str, face: np.ndarray, model_path: Path | None = None) -> np.ndarray | None:
    """Align and crop a detected face to 112x112 using SFace.
    
    Returns BGR numpy array of shape (112, 112, 3), or None on failure. Never raises.
    """
    try:
        if isinstance(image, (str, Path)):
            img = read_image_bgr(image)
        else:
            img = image

        if img is None:
            return None

        recognizer = get_recognizer(model_path)
        if recognizer is None:
            return None

        face_arr = np.asarray(face, dtype=np.float32)
        if face_arr.ndim == 1:
            face_arr = face_arr.reshape(1, -1)

        aligned = recognizer.alignCrop(img, face_arr)
        return aligned
    except Exception:
        return None


def embed_face(image: np.ndarray | Path | str, face: np.ndarray, model_path: Path | None = None) -> np.ndarray | None:
    """Compute 128-dimensional feature embedding vector for a face using SFace.
    
    Returns 1D numpy array of float32, or None on failure. Never raises.
    """
    try:
        aligned = align_and_crop(image, face, model_path)
        if aligned is None:
            return None

        recognizer = get_recognizer(model_path)
        if recognizer is None:
            return None

        feature = recognizer.feature(aligned)
        if feature is None or feature.size == 0:
            return None

        return feature.flatten().astype(np.float32)
    except Exception:
        return None


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Compute cosine similarity between two 1D feature vectors."""
    va = np.asarray(a, dtype=np.float32).flatten()
    vb = np.asarray(b, dtype=np.float32).flatten()
    norm_a = float(np.linalg.norm(va))
    norm_b = float(np.linalg.norm(vb))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return float(np.dot(va, vb) / (norm_a * norm_b))


def same_person(a: np.ndarray, b: np.ndarray, threshold: float = DEFAULT_THRESHOLD) -> bool:
    """Determine whether two face feature embeddings belong to the same person.
    
    Uses cosine similarity against threshold (default 0.363 for SFace).
    Returns True if similarity >= threshold, else False.
    """
    try:
        sim = cosine_similarity(a, b)
        return sim >= threshold
    except Exception:
        return False
