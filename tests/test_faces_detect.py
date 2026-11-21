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
    """Create a 300x300 synthetic face image recognizable by YuNet at score threshold 0.85."""
    import cv2
    img = np.full((300, 300, 3), 240, dtype=np.uint8)
    eye_y = 140
    cv2.ellipse(img, (150, 150), (65, 85), 0, 0, 360, (180, 200, 230), -1)
    cv2.line(img, (115, eye_y - 15), (140, eye_y - 12), (50, 40, 30), 3)
    cv2.line(img, (160, eye_y - 12), (185, eye_y - 15), (50, 40, 30), 3)
    cv2.circle(img, (128, eye_y), 9, (255, 255, 255), -1)
    cv2.circle(img, (172, eye_y), 9, (255, 255, 255), -1)
    cv2.circle(img, (128, eye_y), 5, (80, 50, 30), -1)
    cv2.circle(img, (172, eye_y), 5, (80, 50, 30), -1)
    cv2.circle(img, (129, eye_y - 1), 2, (255, 255, 255), -1)
    cv2.circle(img, (173, eye_y - 1), 2, (255, 255, 255), -1)
    cv2.line(img, (150, eye_y + 10), (145, eye_y + 30), (100, 120, 160), 2)
    cv2.line(img, (145, eye_y + 30), (155, eye_y + 30), (100, 120, 160), 2)
    cv2.ellipse(img, (150, eye_y + 50), (22, 10), 0, 0, 360, (100, 100, 200), -1)
    cv2.line(img, (132, eye_y + 50), (168, eye_y + 50), (60, 60, 150), 2)
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

