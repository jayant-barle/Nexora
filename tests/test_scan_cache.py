"""Tests for face scan caching by file path, size, and SHA-256."""

from pathlib import Path
from unittest.mock import patch
from PIL import Image

from nexora.faces.groups import FaceClusterManager


def _create_plain_image(path: Path, color: tuple[int, int, int] = (120, 120, 120)) -> None:
    img = Image.new("RGB", (64, 64), color=color)
    img.save(path)


def test_unchanged_file_is_not_processed_again(tmp_path: Path):
    """An unchanged file is skipped and not processed again on re-run."""
    src = tmp_path / "src"
    src.mkdir()
    json_path = tmp_path / "runs" / "faces.json"

    img_file = src / "photo1.jpg"
    _create_plain_image(img_file)

    manager = FaceClusterManager(json_path=json_path)

    # Initial scan processes image
    with patch.object(manager, "_process_image", wraps=manager._process_image) as mock_process:
        res1 = manager.scan_source(src)
        assert res1["images_scanned"] == 1
        assert mock_process.call_count == 1

    # Re-run with unchanged file: _process_image must NOT be called
    manager2 = FaceClusterManager(json_path=json_path)
    with patch.object(manager2, "_process_image", wraps=manager2._process_image) as mock_process2:
        res2 = manager2.scan_source(src)
        assert res2["images_scanned"] == 1
        assert mock_process2.call_count == 0


def test_changed_file_is_processed_again(tmp_path: Path):
    """A changed file (different SHA-256) is processed again on re-run."""
    src = tmp_path / "src"
    src.mkdir()
    json_path = tmp_path / "runs" / "faces.json"

    img_file = src / "photo1.jpg"
    _create_plain_image(img_file, color=(10, 10, 10))

    manager = FaceClusterManager(json_path=json_path)
    manager.scan_source(src)

    # Modify image file content
    _create_plain_image(img_file, color=(240, 240, 240))

    # Re-run with modified file: _process_image MUST be called again
    manager2 = FaceClusterManager(json_path=json_path)
    with patch.object(manager2, "_process_image", wraps=manager2._process_image) as mock_process2:
        res2 = manager2.scan_source(src)
        assert res2["images_scanned"] == 1
        assert mock_process2.call_count == 1
