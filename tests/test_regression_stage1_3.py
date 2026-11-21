"""Regression baseline tests for Stages 1 to 3.

Asserts exact results for name rule, date rule, Unsorted rule, collisions,
videos with names, and undo without any face input.
Uses existing expected values from existing tests.
"""

from pathlib import Path
from PIL import Image
import pytest

from nexora.plan import build_plan
from nexora.mover import run_plan, compute_sha256
from nexora.undo import undo_run


def _create_image_with_date(path: Path, date_str: str | None = None) -> Path:
    img = Image.new("RGB", (20, 20), color="green")
    if date_str:
        exif = img.getexif()
        exif[36867] = date_str
        img.save(path, format="JPEG", exif=exif)
    else:
        img.save(path, format="JPEG")
    return path


def test_regression_name_rule_and_videos_with_names(tmp_path: Path) -> None:
    """Stage 1 name rule applies to images and videos with names."""
    src = tmp_path / "source"
    dst = tmp_path / "dest"
    src.mkdir()
    dst.mkdir()

    (src / "nyc.jpg").write_text("fake image", encoding="utf-8")
    (src / "paris_eiffel.mp4").write_text("fake video", encoding="utf-8")

    plan = build_plan(src, dst)
    assert len(plan) == 2

    m1 = next(m for m in plan if m.source.name == "nyc.jpg")
    assert m1.folder == "nyc"
    assert m1.matched_by == "Name: nyc"
    assert m1.target == dst / "nyc" / "nyc.jpg"
    assert m1.status == "ready"

    m2 = next(m for m in plan if m.source.name == "paris_eiffel.mp4")
    assert m2.folder == "paris"
    assert m2.matched_by == "Name: paris"
    assert m2.target == dst / "paris" / "paris_eiffel.mp4"
    assert m2.status == "ready"


def test_regression_date_rule_and_name_precedence(tmp_path: Path) -> None:
    """Stage 2 date rule places dated images, but name rule takes precedence."""
    src = tmp_path / "source"
    dst = tmp_path / "dest"
    src.mkdir()
    dst.mkdir()

    _create_image_with_date(src / "IMG_2034.jpg", "2019:07:14 12:00:00")
    _create_image_with_date(src / "nyc_sunset.jpg", "2019:07:14 12:00:00")

    plan = build_plan(src, dst)
    assert len(plan) == 2

    dated_move = next(m for m in plan if m.source.name == "IMG_2034.jpg")
    assert dated_move.folder == "2019/2019-07"
    assert dated_move.matched_by == "Date: 2019-07"
    assert dated_move.target == dst / "2019" / "2019-07" / "IMG_2034.jpg"
    assert dated_move.status == "ready"

    named_move = next(m for m in plan if m.source.name == "nyc_sunset.jpg")
    assert named_move.folder == "nyc"
    assert named_move.matched_by == "Name: nyc"
    assert named_move.target == dst / "nyc" / "nyc_sunset.jpg"
    assert named_move.status == "ready"


def test_regression_unsorted_rule(tmp_path: Path) -> None:
    """Unnamed and undated images and videos go to Unsorted."""
    src = tmp_path / "source"
    dst = tmp_path / "dest"
    src.mkdir()
    dst.mkdir()

    _create_image_with_date(src / "IMG_9999.jpg", date_str=None)
    (src / "VID_1234.mp4").write_bytes(b"dummy video content")

    plan = build_plan(src, dst)
    assert len(plan) == 2

    img_move = next(m for m in plan if m.source.name == "IMG_9999.jpg")
    assert img_move.folder == "Unsorted"
    assert img_move.matched_by == "Unsorted"
    assert img_move.target == dst / "Unsorted" / "IMG_9999.jpg"
    assert img_move.status == "ready"

    vid_move = next(m for m in plan if m.source.name == "VID_1234.mp4")
    assert vid_move.folder == "Unsorted"
    assert vid_move.matched_by == "Unsorted"
    assert vid_move.target == dst / "Unsorted" / "VID_1234.mp4"
    assert vid_move.status == "ready"


def test_regression_collision_resolution(tmp_path: Path) -> None:
    """Colliding target paths receive numeric suffix."""
    src = tmp_path / "source"
    dst = tmp_path / "dest"
    src.mkdir()
    dst.mkdir()

    nyc_dir = dst / "nyc"
    nyc_dir.mkdir(parents=True)
    (nyc_dir / "nyc.jpg").write_text("already there", encoding="utf-8")
    (src / "nyc.jpg").write_text("new photo", encoding="utf-8")

    plan = build_plan(src, dst)
    assert len(plan) == 1
    assert plan[0].target == dst / "nyc" / "nyc (1).jpg"
    assert plan[0].status == "ready"


def test_regression_undo(tmp_path: Path) -> None:
    """Undo restores every moved file to original path with identical SHA-256."""
    src = tmp_path / "source"
    dst = tmp_path / "dest"
    src.mkdir()
    dst.mkdir()

    f1 = src / "nyc.jpg"
    f2 = src / "paris_sunset.mp4"
    f1.write_bytes(b"nyc photo data")
    f2.write_bytes(b"paris video data")

    sha1 = compute_sha256(f1)
    sha2 = compute_sha256(f2)

    log_path = tmp_path / "runs" / "run.log"
    plan = build_plan(src, dst)
    run_summary = run_plan(plan, log_path)
    assert run_summary["moved"] == 2
    assert not f1.exists()
    assert not f2.exists()

    undo_summary = undo_run(log_path)
    assert undo_summary["restored"] == 2
    assert undo_summary["skipped"] == 0
    assert undo_summary["missing"] == 0

    assert f1.exists()
    assert f2.exists()
    assert compute_sha256(f1) == sha1
    assert compute_sha256(f2) == sha2

    undone_json = log_path.parent / "undone.json"
    assert undone_json.exists()
