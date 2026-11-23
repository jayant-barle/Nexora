"""Tests for face quality metrics: detection quality fields, schema 2 migration, template columns, and quality bucketing."""

from __future__ import annotations

import csv
import json
from pathlib import Path
from unittest.mock import patch
import numpy as np
import pytest
from PIL import Image

from nexora.faces.detect import detect_faces, get_face_box_and_score
from nexora.faces.groups import FaceClusterManager, _worker_process_file
from scripts.measure_faces import evaluate_dataset, classify_face_size, classify_detection_score


def _create_dummy_image(path: Path, size: tuple[int, int] = (200, 200), color: tuple[int, int, int] = (120, 120, 120)) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img = Image.new("RGB", size, color=color)
    img.save(path, format="JPEG")


def test_migration_from_schema_2_keeps_existing_entries_and_bumps_version(tmp_path: Path):
    """Schema 2 file (with old face records missing box_w, box_h, det_score) loads cleanly and migrates to schema 3."""
    json_path = tmp_path / "runs" / "faces.json"
    json_path.parent.mkdir(parents=True, exist_ok=True)

    file_key = str((tmp_path / "old_photo.jpg").resolve())
    schema_2_data = {
        "schema_version": 2,
        "version": 2,
        "cache": {
            file_key: {
                "size": 2048,
                "sha256": "dummy_sha_old",
                "type": "image",
                "status": "ok",
                "faces": [
                    {
                        "box": [20, 25, 80, 85],
                        "score": 0.92,
                        "embedding": [0.05] * 128,
                        "crop_bytes": None,
                        # Notice: box_w, box_h, det_score are missing from schema 2
                    }
                ],
            }
        },
        "groups": [{"id": "group_001", "name": "alice", "display_name": "Alice"}],
        "file_groups": {file_key: ["group_001"]},
        "face_names": {f"{file_key}:0": "Alice"},
        "unreadable": [],
        "dismissed_merges": [],
    }

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(schema_2_data, f, indent=2)

    cm = FaceClusterManager(json_path=json_path)

    # In-memory verification: existing entries are preserved and old face record loads safely
    assert file_key in cm.cache
    face_record = cm.cache[file_key]["faces"][0]
    assert face_record["box"] == [20, 25, 80, 85]
    assert face_record["score"] == 0.92
    assert face_record.get("box_w") is None  # Missing field loads as None, not raising
    assert cm.face_names[f"{file_key}:0"] == "Alice"
    assert cm.groups[0]["name"] == "alice"

    # Disk verification: migrated file has schema_version 3
    with open(json_path, "r", encoding="utf-8") as f:
        migrated = json.load(f)

    assert migrated.get("schema_version") == 3
    assert migrated.get("version") == 3
    assert file_key in migrated["cache"]
    assert migrated["face_names"][f"{file_key}:0"] == "Alice"


def test_scan_stores_new_quality_fields(tmp_path: Path):
    """Face detection and scan worker record box_w, box_h (in original image coordinates), and det_score."""
    img_path = tmp_path / "test_scan_img.jpg"
    _create_dummy_image(img_path, size=(600, 400))

    # Mock face array: [x, y, w, h, ..., score] in original coordinates
    dummy_face = np.zeros(15, dtype=np.float32)
    dummy_face[0] = 50.0   # x
    dummy_face[1] = 60.0   # y
    dummy_face[2] = 120.0  # w (box_w in original pixels)
    dummy_face[3] = 140.0  # h (box_h in original pixels)
    dummy_face[14] = 0.94  # detection score

    dummy_emb = np.zeros(128, dtype=np.float32)
    dummy_emb[0] = 1.0

    with patch("nexora.faces.groups.read_image_bgr", return_value=np.zeros((400, 600, 3), dtype=np.uint8)), \
         patch("nexora.faces.groups.detect_faces", return_value=[dummy_face]), \
         patch("nexora.faces.groups.embed_face", return_value=dummy_emb), \
         patch("nexora.faces.groups.align_and_crop", return_value=None):
        result = _worker_process_file((
            str(img_path.resolve()),
            False,
            img_path.stat().st_size,
            "fake_sha",
            None,
            None,
        ))

    assert result["status"] == "ok"
    assert len(result["faces"]) == 1
    face_rec = result["faces"][0]

    # Verify quality fields are stored
    assert face_rec["box_w"] == 120
    assert face_rec["box_h"] == 140
    assert face_rec["det_score"] == pytest.approx(0.94, abs=1e-3)
    assert face_rec["box"] == [50, 60, 120, 140]

    # Test helper
    helper_res = get_face_box_and_score(dummy_face)
    assert helper_res["box_w"] == 120
    assert helper_res["box_h"] == 140
    assert helper_res["det_score"] == pytest.approx(0.94, abs=1e-3)


def test_template_has_new_quality_columns(tmp_path: Path):
    """The generated ground-truth template CSV contains box_w, box_h, det_score, keeps existing columns, and has no cluster IDs."""
    from scripts.real_library_report import run_real_library_report

    src_dir = tmp_path / "source"
    src_dir.mkdir()
    runs_dir = tmp_path / "runs"
    runs_dir.mkdir()

    img1 = src_dir / "sample1.jpg"
    _create_dummy_image(img1, size=(400, 300))

    dummy_face = np.zeros(15, dtype=np.float32)
    dummy_face[0:4] = [15, 20, 85, 95]
    dummy_face[14] = 0.9123

    with patch("nexora.faces.groups.read_image_bgr", return_value=np.zeros((300, 400, 3), dtype=np.uint8)), \
         patch("nexora.faces.groups.detect_faces", return_value=[dummy_face]), \
         patch("nexora.faces.groups.embed_face", return_value=np.ones(128, dtype=np.float32)), \
         patch("nexora.faces.groups.align_and_crop", return_value=None):
        run_real_library_report(source_dir=src_dir, runs_dir=runs_dir, max_workers=1)

    template_files = list(runs_dir.glob("*_labels_template.csv"))
    assert len(template_files) == 1
    template_csv = template_files[0]

    with open(template_csv, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        rows = list(reader)

    # Required columns present
    assert "box_w" in fieldnames
    assert "box_h" in fieldnames
    assert "det_score" in fieldnames
    assert "file" in fieldnames
    assert "face_index" in fieldnames
    assert "crop_path" in fieldnames
    assert "person" in fieldnames

    # No cluster IDs in the template
    content = template_csv.read_text(encoding="utf-8")
    assert "group_" not in content.lower()

    # Values check
    assert len(rows) == 1
    assert int(rows[0]["box_w"]) == 85
    assert int(rows[0]["box_h"]) == 95
    assert float(rows[0]["det_score"]) == pytest.approx(0.9123, abs=1e-3)
    assert rows[0]["person"] == ""


def test_measurement_table_buckets_correctly(tmp_path: Path):
    """Quality table correctly classifies wrong merges and wrong splits into size and score buckets."""
    img_dir = tmp_path / "images"
    img_dir.mkdir()
    runs_dir = tmp_path / "runs"
    runs_dir.mkdir()

    # Create 4 test images:
    # 1 & 2: Alice, small faces (<60px, e.g. 45px), low score (<0.70, e.g. 0.65) -> will be falsely split
    # 3: Bob, medium face (60-100px, e.g. 75px), score 0.88 (0.85-0.95) -> will falsely merge with Charlie
    # 4: Charlie, large face (>100px, e.g. 150px), score 0.98 (>0.95) -> will falsely merge with Bob
    files = ["alice1.jpg", "alice2.jpg", "bob.jpg", "charlie.jpg"]
    for f in files:
        _create_dummy_image(img_dir / f)

    csv_path = tmp_path / "labels.csv"
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["file", "face_index", "crop_path", "box_w", "box_h", "det_score", "person"])
        writer.writerow(["alice1.jpg", 0, "crop1.jpg", 45, 45, 0.65, "Alice"])
        writer.writerow(["alice2.jpg", 0, "crop2.jpg", 45, 45, 0.65, "Alice"])
        writer.writerow(["bob.jpg", 0, "crop3.jpg", 75, 75, 0.88, "Bob"])
        writer.writerow(["charlie.jpg", 0, "crop4.jpg", 150, 150, 0.98, "Charlie"])

    # Alice1 and Alice2 given orthogonal embeddings -> falsely split
    vec_alice1 = np.zeros(128, dtype=np.float32)
    vec_alice1[0] = 1.0

    vec_alice2 = np.zeros(128, dtype=np.float32)
    vec_alice2[1] = 1.0

    # Bob and Charlie given identical embeddings -> falsely merged
    vec_merged = np.zeros(128, dtype=np.float32)
    vec_merged[2] = 1.0

    def mock_embed(f_path, face, **kwargs):
        name = Path(f_path).name.lower()
        if "alice1" in name:
            return vec_alice1
        elif "alice2" in name:
            return vec_alice2
        else:
            return vec_merged

    txt_out = runs_dir / "report.txt"
    json_out = runs_dir / "report.json"

    with patch("scripts.measure_faces.detect_faces", return_value=[np.zeros(15, dtype=np.float32)]), \
         patch("scripts.measure_faces.embed_face", side_effect=mock_embed):
        res = evaluate_dataset(
            csv_path=csv_path,
            image_dir=img_dir,
            txt_report_output=txt_out,
            json_report_output=json_out,
            is_labels=True,
        )

    # 1. Total errors
    r85 = res["score_0.85"]
    assert r85["false_merges_fp"] == 1
    assert r85["false_splits_fn"] == 1

    # 2. Quality bucketing check
    quality_size = r85["quality_by_size"]
    # Alice1 & Alice2 are size 45px -> pair limiting size is 45px (<60px), so wrong split in <60px
    assert quality_size["<60px"]["wrong_splits"] == 1
    assert quality_size["<60px"]["wrong_merges"] == 0

    # Bob (75px) & Charlie (150px) -> pair limiting size is 75px (60–100px), so wrong merge in 60–100px
    assert quality_size["60–100px"]["wrong_merges"] == 1
    assert quality_size["60–100px"]["wrong_splits"] == 0

    assert quality_size[">100px"]["wrong_merges"] == 0
    assert quality_size[">100px"]["wrong_splits"] == 0

    # 3. Score bucketing check
    quality_score = r85["quality_by_score"]
    # Alice1 & Alice2 score 0.65 -> pair limiting score 0.65 (<0.70)
    assert quality_score["<0.70"]["wrong_splits"] == 1
    assert quality_score["<0.70"]["wrong_merges"] == 0

    # Bob (0.88) & Charlie (0.98) -> pair limiting score is 0.88 (0.85–0.95)
    assert quality_score["0.85–0.95"]["wrong_merges"] == 1
    assert quality_score["0.85–0.95"]["wrong_splits"] == 0

    # 4. Report text check
    report_text = txt_out.read_text(encoding="utf-8")
    assert "--- 4. WRONG MERGES AND WRONG SPLITS BY FACE QUALITY ---" in report_text
    assert "[By Face Size Bucket" in report_text
    assert "[By Detection Score Bucket" in report_text
    assert "<60px" in report_text
    assert "60–100px" in report_text
    assert ">100px" in report_text
