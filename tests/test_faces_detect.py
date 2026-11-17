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
