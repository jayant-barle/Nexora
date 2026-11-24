"""Tests for scripts/measure_faces.py: per-face labelling template, blank handling, and missing files."""

from __future__ import annotations

import csv
import json
from pathlib import Path
from unittest.mock import patch
import numpy as np
import pytest
from PIL import Image

from scripts.measure_faces import evaluate_dataset, main


def _create_dummy_image(path: Path, color: tuple[int, int, int] = (100, 100, 100)) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img = Image.new("RGB", (100, 100), color=color)
    img.save(path, format="JPEG")


def test_measure_faces_synthetic_3_people_with_blanks(tmp_path: Path):
    """Synthetic labelled CSV with 3 people and blanks: verify report counts and metrics."""
    img_dir = tmp_path / "images"
    img_dir.mkdir()
    runs_dir = tmp_path / "runs"
    runs_dir.mkdir()

    # 3 people: Alice (2), Bob (2), Charlie (2) + 3 blanks
    data = [
        ("alice1.jpg", 0, "Alice"),
        ("alice2.jpg", 0, "Alice"),
        ("bob1.jpg", 0, "Bob"),
        ("bob2.jpg", 0, "Bob"),
        ("charlie1.jpg", 0, "Charlie"),
        ("charlie2.jpg", 0, "Charlie"),
        ("blank1.jpg", 0, ""),
        ("blank2.jpg", 0, "   "),
        ("blank3.jpg", 0, ""),
    ]

    for fname, _, _ in data:
        _create_dummy_image(img_dir / fname)

    csv_path = tmp_path / "labels.csv"
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["file", "face_index", "crop_path", "person"])
        for idx, (fname, f_idx, person) in enumerate(data):
            writer.writerow([fname, f_idx, f"runs/face_crops/crop_{idx:04d}.jpg", person])

    # Construct orthogonal 128-d unit vectors for each identity
    vec_alice = np.zeros(128, dtype=np.float32)
    vec_alice[0] = 1.0

    vec_bob = np.zeros(128, dtype=np.float32)
    vec_bob[1] = 1.0

    vec_charlie = np.zeros(128, dtype=np.float32)
    vec_charlie[2] = 1.0

    vec_other = np.zeros(128, dtype=np.float32)
    vec_other[3] = 1.0

    def mock_detect(f_path, **kwargs):
        # 1 detected face per image with high score
        face = np.zeros(15, dtype=np.float32)
        face[0:4] = [10, 10, 50, 50]
        face[14] = 0.95
        return [face]

    def mock_embed(f_path, face, **kwargs):
        name = Path(f_path).name.lower()
        if "alice" in name:
            return vec_alice
        elif "bob" in name:
            return vec_bob
        elif "charlie" in name:
            return vec_charlie
        return vec_other

    txt_out = runs_dir / "report.txt"
    json_out = runs_dir / "report.json"

    with patch("scripts.measure_faces.detect_faces", side_effect=mock_detect), \
         patch("scripts.measure_faces.embed_face", side_effect=mock_embed):
        res = evaluate_dataset(
            csv_path=csv_path,
            image_dir=img_dir,
            txt_report_output=txt_out,
            json_report_output=json_out,
        )

    # 1. Report counts
    summary = res["summary"]
    assert summary["labelled_faces"] == 6
    assert summary["unlabelled_rows_ignored"] == 3
    assert summary["distinct_people"] == 3
    assert summary["people"] == ["Alice", "Bob", "Charlie"]
    assert summary["total_files"] == 6

    # Ground truth pairs:
    # 6 faces total => 15 pairs
    # Same person pairs: Alice (1) + Bob (1) + Charlie (1) = 3
    # Different person pairs: 15 - 3 = 12
    assert summary["same_person_pairs"] == 3
    assert summary["diff_person_pairs"] == 12

    # Accuracy at 0.85
    r_85 = res["score_0.85"]
    assert r_85["true_positives_tp"] == 3
    assert r_85["false_splits_fn"] == 0
    assert r_85["false_merges_fp"] == 0
    assert r_85["true_negatives_tn"] == 12
    assert r_85["pairwise_precision"] == 1.0
    assert r_85["pairwise_recall"] == 1.0
    assert r_85["false_positive_rate"] == 0.0
    assert r_85["num_clusters"] == 3

    # Check generated report files
    assert txt_out.exists()
    assert json_out.exists()
    report_text = txt_out.read_text(encoding="utf-8")
    assert "Labelled faces:          6" in report_text
    assert "Unlabelled rows ignored: 3" in report_text
    assert "Distinct people:         3 (Alice, Bob, Charlie)" in report_text


def test_blank_rows_are_ignored(tmp_path: Path):
    """Blank rows (empty or spaces) are ignored from evaluation and correctly counted."""
    img_dir = tmp_path / "images"
    img_dir.mkdir()

    # 2 labelled faces + 4 blank rows
    data = [
        ("person1.jpg", 0, "Person1"),
        ("blank_empty.jpg", 0, ""),
        ("person2.jpg", 0, "Person2"),
        ("blank_space.jpg", 0, "   "),
        ("blank_tab.jpg", 0, "\t"),
        ("blank_none.jpg", 0, ""),
    ]

    for fname, _, _ in data:
        _create_dummy_image(img_dir / fname)

    csv_path = tmp_path / "blanks.csv"
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["file", "face_index", "crop_path", "person"])
        for idx, (fname, f_idx, person) in enumerate(data):
            writer.writerow([fname, f_idx, f"crop_{idx}.jpg", person])

    with patch("scripts.measure_faces.detect_faces", return_value=[np.zeros(15, dtype=np.float32)]), \
         patch("scripts.measure_faces.embed_face", return_value=np.ones(128, dtype=np.float32)):
        res = evaluate_dataset(
            csv_path=csv_path,
            image_dir=img_dir,
            txt_report_output=tmp_path / "report.txt",
        )

    summary = res["summary"]
    assert summary["labelled_faces"] == 2
    assert summary["unlabelled_rows_ignored"] == 4
    assert summary["distinct_people"] == 2
    assert summary["people"] == ["Person1", "Person2"]


def test_script_exits_cleanly_when_labels_points_at_missing_file(tmp_path: Path):
    """The script exits cleanly (code 0, empty dict, informative message) when --labels points at a missing file."""
    missing_csv = tmp_path / "nonexistent_labels.csv"
    txt_out = tmp_path / "measure_report.txt"

    # Direct evaluate_dataset call
    res = evaluate_dataset(
        csv_path=missing_csv,
        txt_report_output=txt_out,
    )
    assert res == {}
    assert txt_out.exists()
    content = txt_out.read_text(encoding="utf-8")
    assert "No labelled dataset found at" in content
    assert "Accuracy not yet measured. Owner review pending." in content

    # CLI main() call with --labels
    exit_code = main(["--labels", str(missing_csv), "--output-txt", str(txt_out)])
    assert exit_code == 0


def test_false_merges_reported_with_filenames(tmp_path: Path):
    """When different people are clustered together, false merge details list the files and people."""
    img_dir = tmp_path / "images"
    img_dir.mkdir()

    _create_dummy_image(img_dir / "alice.jpg")
    _create_dummy_image(img_dir / "bob.jpg")

    csv_path = tmp_path / "false_merge.csv"
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["file", "face_index", "crop_path", "person"])
        writer.writerow(["alice.jpg", 0, "crop0.jpg", "Alice"])
        writer.writerow(["bob.jpg", 0, "crop1.jpg", "Bob"])

    # Both images return identical embeddings -> forced false merge
    identical_emb = np.zeros(128, dtype=np.float32)
    identical_emb[0] = 1.0

    txt_out = tmp_path / "fm_report.txt"

    with patch("scripts.measure_faces.detect_faces", return_value=[np.zeros(15, dtype=np.float32)]), \
         patch("scripts.measure_faces.embed_face", return_value=identical_emb):
        res = evaluate_dataset(
            csv_path=csv_path,
            image_dir=img_dir,
            txt_report_output=txt_out,
        )

    r_85 = res["score_0.85"]
    assert r_85["false_merges_fp"] == 1
    assert len(r_85["false_merges"]) == 1
    fm = r_85["false_merges"][0]
    assert fm["file_a"] == "alice.jpg"
    assert fm["person_a"] == "Alice"
    assert fm["file_b"] == "bob.jpg"
    assert fm["person_b"] == "Bob"

    report_text = txt_out.read_text(encoding="utf-8")
    assert "MERGED WITH 'bob.jpg'" in report_text


def test_legacy_expected_faces_csv_compatibility(tmp_path: Path):
    """Existing 2-column expected_faces.csv format (file, person) continues to work."""
    img_dir = tmp_path / "images"
    img_dir.mkdir()

    _create_dummy_image(img_dir / "person_a.jpg")
    _create_dummy_image(img_dir / "person_b.jpg")

    legacy_csv = tmp_path / "expected_faces.csv"
    with open(legacy_csv, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["file", "person"])
        writer.writerow(["person_a.jpg", "PersonA"])
        writer.writerow(["person_b.jpg", "PersonB"])

    emb_a = np.zeros(128, dtype=np.float32)
    emb_a[0] = 1.0
    emb_b = np.zeros(128, dtype=np.float32)
    emb_b[1] = 1.0

    def mock_embed(f_path, face, **kwargs):
        return emb_a if "person_a" in str(f_path) else emb_b

    with patch("scripts.measure_faces.detect_faces", return_value=[np.zeros(15, dtype=np.float32)]), \
         patch("scripts.measure_faces.embed_face", side_effect=mock_embed):
        res = evaluate_dataset(
            csv_path=legacy_csv,
            image_dir=img_dir,
            txt_report_output=tmp_path / "legacy_report.txt",
        )

    summary = res["summary"]
    assert summary["labelled_faces"] == 2
    assert summary["unlabelled_rows_ignored"] == 0
    assert summary["distinct_people"] == 2
