"""Tests for People feature improvements: scan resume, atomic save resilience, quality filtering, and minimum group visibility."""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from unittest.mock import patch
import numpy as np
import pytest
from PIL import Image

from nexora.faces.detect import passes_quality_filter, MIN_FACE_SIZE, MAX_ASPECT_RATIO, SCORE_THRESHOLD
from nexora.faces.groups import FaceClusterManager
from nexora.faces.people import PeopleManager, MIN_VISIBLE_GROUP_SIZE


def _make_dummy_image(path: Path, color: tuple[int, int, int] = (128, 128, 128)) -> None:
    img = Image.new("RGB", (100, 100), color=color)
    img.save(path, format="JPEG")


def test_scan_resume_skips_already_scanned_files(tmp_path: Path):
    """Scan stops after 60 images, saves cache, and resumes skipping the first 60 images."""
    src = tmp_path / "source"
    src.mkdir()
    runs_dir = tmp_path / "runs"
    runs_dir.mkdir()
    json_path = runs_dir / "faces.json"

    # Create 65 synthetic images
    for i in range(65):
        _make_dummy_image(src / f"img_{i:03d}.jpg", color=((i * 3) % 255, (i * 7) % 255, (i * 11) % 255))

    stop_event = threading.Event()
    cm1 = FaceClusterManager(json_path=json_path)

    # Use a callback or direct mock to signal stop after 60 images
    call_count = 0

    def mock_process_image(file_path: Path, size: int, sha256: str) -> list[dict]:
        nonlocal call_count
        call_count += 1
        if call_count >= 60:
            stop_event.set()
        return []

    with patch.object(cm1, "_process_image", side_effect=mock_process_image):
        cm1.scan_source(src, stop_event=stop_event, max_workers=1)

    assert json_path.exists(), "Cache file must exist after first scan"
    assert len(cm1.cache) == 60, f"Expected 60 cached files, got {len(cm1.cache)}"

    # Resume with second manager
    cm2 = FaceClusterManager(json_path=json_path)
    assert len(cm2.cache) == 60, "cm2 should load 60 items from disk"

    second_scan_processed: list[Path] = []

    def mock_process_image_2(file_path: Path, size: int, sha256: str) -> list[dict]:
        second_scan_processed.append(file_path)
        return []

    with patch.object(cm2, "_process_image", side_effect=mock_process_image_2):
        summary = cm2.scan_source(src, max_workers=1)

    # The 60 unchanged files are cache hits; only the remaining 5 were processed
    assert len(second_scan_processed) == 5, f"Expected only 5 uncached files to be processed, got {len(second_scan_processed)}"
    assert len(cm2.cache) == 65, f"Expected all 65 files in cache after resume, got {len(cm2.cache)}"
    assert summary["images_scanned"] == 65


def test_atomic_save_crash_resilience(tmp_path: Path):
    """Simulate a crash during save; original faces.json must remain intact and valid JSON."""
    json_path = tmp_path / "faces.json"
    initial_data = {
        "version": 1,
        "cache": {"file1.jpg": {"size": 100, "sha256": "abc", "type": "image", "status": "ok", "faces": []}},
        "groups": [{"id": "group_001", "name": "Alice"}],
        "file_groups": {"file1.jpg": ["group_001"]},
    }
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(initial_data, f, indent=2)

    cm = FaceClusterManager(json_path=json_path)
    assert len(cm.cache) == 1

    # Mutate in memory
    cm.cache["file2.jpg"] = {"size": 200, "sha256": "def", "type": "image", "status": "ok", "faces": []}

    # Simulate a crash when writing the temp file
    with patch("json.dump", side_effect=OSError("Disk full or simulated crash during write")):
        with pytest.raises(OSError, match="simulated crash"):
            cm.save()

    # The original file must still be valid JSON matching initial_data
    assert json_path.exists()
    with open(json_path, "r", encoding="utf-8") as f:
        loaded = json.load(f)
    assert loaded["cache"] == initial_data["cache"]
    assert "file2.jpg" not in loaded["cache"]
    assert loaded["groups"][0]["name"] == "Alice"


def test_quality_filter_drops_small_and_extreme_aspect_ratio_boxes():
    """Verify quality filter drops faces under 48px or aspect ratio > 2.5."""
    assert MIN_FACE_SIZE == 48
    assert MAX_ASPECT_RATIO == 2.5
    assert SCORE_THRESHOLD == 0.85

    # Valid square face >= 48px
    valid_box = np.array([10.0, 10.0, 60.0, 60.0, 0.9])
    assert passes_quality_filter(valid_box) is True

    # Too small width (< 48px)
    too_narrow_box = np.array([10.0, 10.0, 40.0, 60.0, 0.9])
    assert passes_quality_filter(too_narrow_box) is False

    # Too small height (< 48px)
    too_short_box = np.array([10.0, 10.0, 60.0, 45.0, 0.9])
    assert passes_quality_filter(too_short_box) is False

    # Very tall, thin box (height / width > 2.5: 130 / 50 = 2.6)
    tall_thin_box = np.array([10.0, 10.0, 50.0, 130.0, 0.9])
    assert passes_quality_filter(tall_thin_box) is False

    # Very wide, flat box (width / height > 2.5: 140 / 50 = 2.8)
    wide_flat_box = np.array([10.0, 10.0, 140.0, 50.0, 0.9])
    assert passes_quality_filter(wide_flat_box) is False


def test_minimum_group_size_visibility(tmp_path: Path):
    """Groups with 1 or 2 faces are hidden on People screen; groups with >= 3 faces are visible."""
    assert MIN_VISIBLE_GROUP_SIZE == 3
    json_path = tmp_path / "faces.json"
    cm = FaceClusterManager(json_path=json_path)
    cm.groups = [
        {"id": "group_001", "name": None, "representative_embedding": []},
        {"id": "group_002", "name": None, "representative_embedding": []},
        {"id": "group_003", "name": None, "representative_embedding": []},
    ]
    # group_001 has 1 face, group_002 has 2 faces, group_003 has 3 faces
    cm.file_groups = {
        "img1.jpg": ["group_001"],
        "img2.jpg": ["group_002", "group_002"],
        "img3.jpg": ["group_003", "group_003"],
        "img4.jpg": ["group_003"],
    }
    pm = PeopleManager(cm)

    assert pm.get_group_size("group_001") == 1
    assert pm.get_group_size("group_002") == 2
    assert pm.get_group_size("group_003") == 3

    visible = pm.get_visible_groups()
    visible_ids = [g["id"] for g in visible]

    assert "group_003" in visible_ids, "Group with 3 faces must be visible"
    assert "group_001" not in visible_ids, "Group with 1 face must be hidden"
    assert "group_002" not in visible_ids, "Group with 2 faces must be hidden"
    assert len(visible) == 1

    # But all groups remain in faces.json
    cm.save()
    assert json_path.exists()
    cm_reloaded = FaceClusterManager(json_path=json_path)
    assert len(cm_reloaded.groups) == 3
