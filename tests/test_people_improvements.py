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
    """Clusters with 1 face are hidden on People screen; clusters with >= 2 faces are visible."""
    assert MIN_VISIBLE_GROUP_SIZE == 2
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
    assert "group_002" in visible_ids, "Group with 2 faces must be visible under MIN_VISIBLE_GROUP_SIZE = 2"
    assert "group_001" not in visible_ids, "Group with 1 face must be hidden"
    assert len(visible) == 2

    # But all groups remain in faces.json
    cm.save()
    assert json_path.exists()
    cm_reloaded = FaceClusterManager(json_path=json_path)
    assert len(cm_reloaded.groups) == 3


def test_clustering_shuffle_invariance(tmp_path: Path):
    """Clustering produces identical clusters regardless of the order files/faces are provided."""
    import random

    # Create synthetic embeddings: 2 clusters of 3 faces each, plus 1 outlier
    # Cluster A: near [1, 0, ...]
    # Cluster B: near [0, 1, ...]
    emb_a1 = [1.0] + [0.0] * 127
    emb_a2 = [0.98, 0.05] + [0.0] * 126
    emb_a3 = [0.96, -0.05] + [0.0] * 126

    emb_b1 = [0.0, 1.0] + [0.0] * 126
    emb_b2 = [0.05, 0.98] + [0.0] * 126
    emb_b3 = [-0.05, 0.96] + [0.0] * 126

    emb_c1 = [0.0, 0.0, 1.0] + [0.0] * 125

    items = [
        ("file_a1.jpg", emb_a1),
        ("file_a2.jpg", emb_a2),
        ("file_a3.jpg", emb_a3),
        ("file_b1.jpg", emb_b1),
        ("file_b2.jpg", emb_b2),
        ("file_b3.jpg", emb_b3),
        ("file_c1.jpg", emb_c1),
    ]

    # Run 1: original order
    cm1 = FaceClusterManager(json_path=tmp_path / "faces1.json")
    for fname, emb in items:
        cm1.cache[fname] = {
            "size": 100,
            "sha256": "sha",
            "type": "image",
            "faces": [{"box": [10, 10, 50, 50], "score": 0.9, "embedding": emb}],
        }
    cm1.cluster_all_faces(threshold=0.363)
    clusters_run1 = [sorted(g["member_faces"]) for g in cm1.groups]

    # Run 2: shuffled order 1
    cm2 = FaceClusterManager(json_path=tmp_path / "faces2.json")
    shuffled_items_1 = list(items)
    random.Random(42).shuffle(shuffled_items_1)
    for fname, emb in shuffled_items_1:
        cm2.cache[fname] = {
            "size": 100,
            "sha256": "sha",
            "type": "image",
            "faces": [{"box": [10, 10, 50, 50], "score": 0.9, "embedding": emb}],
        }
    cm2.cluster_all_faces(threshold=0.363)
    clusters_run2 = [sorted(g["member_faces"]) for g in cm2.groups]

    # Run 3: shuffled order 2
    cm3 = FaceClusterManager(json_path=tmp_path / "faces3.json")
    shuffled_items_2 = list(items)
    random.Random(999).shuffle(shuffled_items_2)
    for fname, emb in shuffled_items_2:
        cm3.cache[fname] = {
            "size": 100,
            "sha256": "sha",
            "type": "image",
            "faces": [{"box": [10, 10, 50, 50], "score": 0.9, "embedding": emb}],
        }
    cm3.cluster_all_faces(threshold=0.363)
    clusters_run3 = [sorted(g["member_faces"]) for g in cm3.groups]

    assert clusters_run1 == clusters_run2, "Clustering run 2 must produce identical clusters"
    assert clusters_run1 == clusters_run3, "Clustering run 3 must produce identical clusters"


def test_clustering_idempotent_rescan_and_preserves_names(tmp_path: Path):
    """Re-running clustering produces identical clusters and preserves names stored by member face."""
    emb_a1 = [1.0] + [0.0] * 127
    emb_a2 = [0.95, 0.05] + [0.0] * 126

    emb_b1 = [0.0, 1.0] + [0.0] * 126
    emb_b2 = [0.05, 0.95] + [0.0] * 126

    json_path = tmp_path / "faces.json"
    cm = FaceClusterManager(json_path=json_path)
    cm.cache = {
        "img_a1.jpg": {"size": 10, "sha256": "s1", "type": "image", "faces": [{"embedding": emb_a1}]},
        "img_a2.jpg": {"size": 10, "sha256": "s2", "type": "image", "faces": [{"embedding": emb_a2}]},
        "img_b1.jpg": {"size": 10, "sha256": "s3", "type": "image", "faces": [{"embedding": emb_b1}]},
        "img_b2.jpg": {"size": 10, "sha256": "s4", "type": "image", "faces": [{"embedding": emb_b2}]},
    }

    # Initial clustering
    cm.cluster_all_faces(threshold=0.363)
    assert len(cm.groups) == 2

    # Name group_001 "Alice"
    pm = PeopleManager(cm)
    pm.name_group("group_001", "Alice")
    assert cm.groups[0]["display_name"] == "Alice"
    assert cm.face_names["img_a1.jpg:0"] == "Alice"
    assert cm.face_names["img_a2.jpg:0"] == "Alice"

    # Re-run clustering
    cm.cluster_all_faces(threshold=0.363)
    assert len(cm.groups) == 2
    assert cm.groups[0]["display_name"] == "Alice", "Name Alice must survive re-clustering"
    assert cm.groups[0]["name"] == "alice"
    assert cm.groups[1]["display_name"] is None


def test_scan_mid_run_kill_and_resume_loses_no_progress(tmp_path: Path):
    """Kill scan mid-run, restart, and confirm no cached file is rescanned and progress is kept."""
    src = tmp_path / "src"
    src.mkdir()
    json_path = tmp_path / "faces.json"

    for i in range(10):
        _make_dummy_image(src / f"img_{i:02d}.jpg")

    stop_event = threading.Event()
    cm = FaceClusterManager(json_path=json_path)

    # Stop after 4 files
    count = 0

    def mock_process_image(p: Path, sz: int, sha: str) -> list[dict]:
        nonlocal count
        count += 1
        if count >= 4:
            stop_event.set()
        return [{"box": [10, 10, 50, 50], "score": 0.9, "embedding": [1.0] * 128}]

    with patch.object(cm, "_process_image", side_effect=mock_process_image):
        cm.scan_source(src, stop_event=stop_event, max_workers=1)

    assert json_path.exists()
    assert len(cm.cache) == 4, f"Expected 4 cached items, got {len(cm.cache)}"

    # Resume with fresh manager
    cm2 = FaceClusterManager(json_path=json_path)
    assert len(cm2.cache) == 4

    rescanned_files: list[Path] = []

    def mock_process_image_resume(p: Path, sz: int, sha: str) -> list[dict]:
        rescanned_files.append(p)
        return [{"box": [10, 10, 50, 50], "score": 0.9, "embedding": [1.0] * 128}]

    with patch.object(cm2, "_process_image", side_effect=mock_process_image_resume):
        res = cm2.scan_source(src, max_workers=1)

    # 4 were cached and skipped; only the remaining 6 were scanned
    assert len(rescanned_files) == 6, f"Expected 6 files scanned on resume, got {len(rescanned_files)}"
    assert len(cm2.cache) == 10
    assert res["images_scanned"] == 10
