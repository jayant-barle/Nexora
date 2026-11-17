"""Tests for face detection via YuNet."""

from pathlib import Path
import numpy as np
from PIL import Image

from nexora.faces.detect import detect_faces


def test_detect_faces_blank_image(tmp_path: Path):
    """Detection returns an empty list on a blank image."""
    img_path = tmp_path / "blank.jpg"
    img = Image.new("RGB", (320, 320), color=(0, 0, 0))
    img.save(img_path)

    faces = detect_faces(img_path)
    assert faces == []


def test_detect_faces_corrupt_file_returns_empty_and_does_not_raise(tmp_path: Path):
    """Corrupt image returns empty list without raising."""
    corrupt_path = tmp_path / "corrupt.jpg"
    corrupt_path.write_bytes(b"not a valid image content")

    faces = detect_faces(corrupt_path)
    assert faces == []


def test_detect_faces_missing_file_returns_empty_and_does_not_raise(tmp_path: Path):
    """Non-existent image returns empty list without raising."""
    missing_path = tmp_path / "missing.png"
    faces = detect_faces(missing_path)
    assert faces == []


def _create_synthetic_face_image() -> np.ndarray:
    """Create a 300x300 synthetic face image recognizable by YuNet at score threshold 0.6."""
    img = np.full((300, 300, 3), 180, dtype=np.uint8)
    import cv2
    cv2.ellipse(img, (150, 150), (60, 80), 0, 0, 360, (140, 180, 220), -1)
    cv2.circle(img, (130, 130), 8, (20, 20, 20), -1)
    cv2.circle(img, (170, 130), 8, (20, 20, 20), -1)
    cv2.line(img, (150, 140), (150, 165), (20, 20, 20), 3)
    cv2.line(img, (135, 185), (165, 185), (20, 20, 20), 4)
    return img


def test_detect_faces_synthetic_sideways_detected_after_rotation(tmp_path: Path):
    """A synthetic sideways image is detected via the rotation retry cascade."""
    import cv2
    upright = _create_synthetic_face_image()
    sideways = cv2.rotate(upright, cv2.ROTATE_90_CLOCKWISE)

    sideways_path = tmp_path / "sideways.png"
    cv2.imwrite(str(sideways_path), sideways)

    faces = detect_faces(sideways_path)
    assert len(faces) >= 1, "Sideways face should be detected via rotation fallback"
    # Check that bounding box is valid and inverted back
    face = faces[0]
    assert face[2] >= 20 and face[3] >= 20, "Face dimensions must satisfy minimum size"

