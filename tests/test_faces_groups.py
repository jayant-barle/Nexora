"""Tests for face clustering, caching, and group management."""

from pathlib import Path
from unittest.mock import patch
from PIL import Image

from nexora.faces.groups import FaceClusterManager


def _create_plain_image(path: Path) -> None:
    img = Image.new("RGB", (64, 64), color=(120, 120, 120))
    img.save(path)


def test_face_caching_skips_unchanged_files(tmp_path: Path):
    """An unchanged file is not processed again on re-run."""
    src = tmp_path / "src"
    src.mkdir()
    json_path = tmp_path / "runs" / "faces.json"

    img_file = src / "IMG_1001.jpg"
    _create_plain_image(img_file)

    manager = FaceClusterManager(json_path=json_path)

    # First scan calls _process_image
    with patch.object(manager, "_process_image", wraps=manager._process_image) as mock_process:
        res1 = manager.scan_source(src)
        assert res1["images_scanned"] == 1
        assert mock_process.call_count == 1

    # Second scan with unchanged file should NOT call _process_image
    manager2 = FaceClusterManager(json_path=json_path)
    with patch.object(manager2, "_process_image", wraps=manager2._process_image) as mock_process2:
        res2 = manager2.scan_source(src)
        assert res2["images_scanned"] == 1
        assert mock_process2.call_count == 0, "Unchanged file should use cache and not be re-processed"


def test_group_naming_and_merging(tmp_path: Path):
    """Naming two groups with the same name merges them for the same person."""
    json_path = tmp_path / "runs" / "faces.json"
    manager = FaceClusterManager(json_path=json_path)

    # Manually configure two synthetic groups
    manager.groups = [
        {"id": "group_001", "name": None, "representative_embedding": [1.0] + [0.0] * 127},
        {"id": "group_002", "name": None, "representative_embedding": [0.0, 1.0] + [0.0] * 126},
    ]

    manager.name_group("group_001", "Alice")
    manager.name_group("group_002", "alice")  # Same name merges them

    assert manager.get_group_name("group_001") == "alice"
    assert manager.get_group_name("group_002") == "alice"


def test_build_face_map_rules(tmp_path: Path):
    """Verify face map rules: single named person -> name, multi-person -> None, unnamed -> None."""
    json_path = tmp_path / "runs" / "faces.json"
    manager = FaceClusterManager(json_path=json_path)

    manager.groups = [
        {"id": "group_001", "name": "alice", "representative_embedding": [1.0] * 128},
        {"id": "group_002", "name": "bob", "representative_embedding": [-1.0] * 128},
        {"id": "group_003", "name": None, "representative_embedding": [0.5] * 128},
    ]

    manager.file_groups = {
        "file_alice.jpg": ["group_001"],
        "file_bob.jpg": ["group_002"],
        "file_multi.jpg": ["group_001", "group_002"],
        "file_unnamed.jpg": ["group_003"],
        "file_alice_and_unnamed.jpg": ["group_001", "group_003"],
        "file_empty.jpg": [],
    }

    face_map = manager.build_face_map()

    # Single named person -> folder name
    assert face_map["file_alice.jpg"] == "alice"
    assert face_map["file_bob.jpg"] == "bob"

    # Multi-person -> None (Unsorted)
    assert face_map["file_multi.jpg"] is None

    # Unnamed group only -> None (Unsorted)
    assert face_map["file_unnamed.jpg"] is None

    # Mixed named + unnamed -> None (Unsorted)
    assert face_map["file_alice_and_unnamed.jpg"] is None

    # No faces -> None (Unsorted)
    assert face_map["file_empty.jpg"] is None
