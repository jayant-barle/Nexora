"""Test that scan_source does not leave orphan temporary crop files in face_crops/."""

import threading
from pathlib import Path
from unittest.mock import patch
import cv2
import numpy as np

from nexora.faces.groups import FaceClusterManager


def test_scan_orphan_crops(tmp_path: Path) -> None:
    # Rule 4: tmp_path only
    photos_dir = tmp_path / "photos"
    photos_dir.mkdir(parents=True, exist_ok=True)
    runs_dir = tmp_path / "runs"

    # Create 2 fake images with distinct content
    img1 = photos_dir / "img1.jpg"
    img2 = photos_dir / "img2.jpg"
    cv2.imwrite(str(img1), np.zeros((100, 100, 3), dtype=np.uint8))
    cv2.imwrite(str(img2), np.ones((100, 100, 3), dtype=np.uint8) * 255)

    cm = FaceClusterManager(json_path=runs_dir / "faces.json")

    # Stub detector: returns 2 faces for img1 (mean < 128) and 1 face for img2 (mean >= 128)
    def mock_detect(img, *args, **kwargs):
        face_dummy = np.array([10, 10, 50, 50, 20, 20, 40, 20, 30, 30, 25, 40, 35, 40, 0.99])
        if img.mean() < 128:
            return [face_dummy, face_dummy]
        return [face_dummy]

    # Stub embedder: returns fixed 128-d array
    def mock_embed(img, face, *args, **kwargs):
        return np.full(128, 0.5, dtype=np.float32)

    with patch("nexora.faces.groups.detect_faces", side_effect=mock_detect), \
         patch("nexora.faces.groups.embed_face", side_effect=mock_embed), \
         patch("nexora.faces.groups.align_and_crop", return_value=np.zeros((112, 112, 3), dtype=np.uint8)):
        cm.scan_source(photos_dir, max_workers=1)

    crops_dir = runs_dir / "face_crops"
    assert crops_dir.exists(), "face_crops directory must exist"

    all_crop_files = set(p.name for p in crops_dir.glob("*.jpg"))
    referenced_crops = set()
    for g in cm.groups:
        if g.get("crop_path"):
            referenced_crops.add(Path(g["crop_path"]).name)
        for cp in g.get("crop_paths", []):
            referenced_crops.add(Path(cp).name)

    orphan_files = all_crop_files - referenced_crops
    assert not orphan_files, f"Expected no orphan crop files, but found: {sorted(orphan_files)}"
    assert all_crop_files == referenced_crops
    assert not any(f.startswith("crop_group_") for f in all_crop_files), f"Temporary crop files still exist: {all_crop_files}"


def test_scan_stopped_midway_and_resumed_has_all_data_and_no_orphans(tmp_path: Path) -> None:
    # Rule 4: tmp_path only
    photos_dir = tmp_path / "photos"
    photos_dir.mkdir(parents=True, exist_ok=True)
    runs_dir = tmp_path / "runs"

    img1 = photos_dir / "img1.jpg"
    img2 = photos_dir / "img2.jpg"
    cv2.imwrite(str(img1), np.zeros((100, 100, 3), dtype=np.uint8))
    cv2.imwrite(str(img2), np.ones((100, 100, 3), dtype=np.uint8) * 255)

    cm = FaceClusterManager(json_path=runs_dir / "faces.json")

    stop_event = threading.Event()
    detect_calls = 0

    def mock_detect(img, *args, **kwargs):
        nonlocal detect_calls
        detect_calls += 1
        if detect_calls >= 1:
            stop_event.set()
        face_dummy = np.array([10, 10, 50, 50, 20, 20, 40, 20, 30, 30, 25, 40, 35, 40, 0.99])
        if img.mean() < 128:
            return [face_dummy, face_dummy]
        return [face_dummy]

    def mock_embed(img, face, *args, **kwargs):
        return np.full(128, 0.5, dtype=np.float32)

    with patch("nexora.faces.groups.detect_faces", side_effect=mock_detect), \
         patch("nexora.faces.groups.embed_face", side_effect=mock_embed), \
         patch("nexora.faces.groups.align_and_crop", return_value=np.zeros((112, 112, 3), dtype=np.uint8)):
        cm.scan_source(photos_dir, max_workers=1, stop_event=stop_event)

    # First run was stopped midway: only 1 file cached
    assert len(cm.cache) == 1

    # Resume with a new FaceClusterManager on the same json_path
    cm2 = FaceClusterManager(json_path=runs_dir / "faces.json")
    cm2.load()
    with patch("nexora.faces.groups.detect_faces", side_effect=mock_detect), \
         patch("nexora.faces.groups.embed_face", side_effect=mock_embed), \
         patch("nexora.faces.groups.align_and_crop", return_value=np.zeros((112, 112, 3), dtype=np.uint8)):
        cm2.scan_source(photos_dir, max_workers=1)

    # Both images cached now
    assert len(cm2.cache) == 2
    # Total 3 faces clustered into groups
    total_clustered_faces = sum(g["final_count"] for g in cm2.groups)
    assert total_clustered_faces == 3

    crops_dir = runs_dir / "face_crops"
    all_crop_files = set(p.name for p in crops_dir.glob("*.jpg"))
    referenced_crops = set()
    for g in cm2.groups:
        if g.get("crop_path"):
            referenced_crops.add(Path(g["crop_path"]).name)
        for cp in g.get("crop_paths", []):
            referenced_crops.add(Path(cp).name)

    orphan_files = all_crop_files - referenced_crops
    assert not orphan_files, f"Expected no orphan crop files, but found: {sorted(orphan_files)}"
    assert all_crop_files == referenced_crops
    assert not any(f.startswith("crop_group_") for f in all_crop_files)
