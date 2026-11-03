"""Unit tests for nexora.plan build_plan."""

from pathlib import Path
from PIL import Image
import pytest

from nexora.plan import build_plan


def _create_image_with_date(path: Path, date_str: str | None = None) -> Path:
    img = Image.new("RGB", (20, 20), color="green")
    if date_str:
        exif = img.getexif()
        exif[36867] = date_str
        img.save(path, format="JPEG", exif=exif)
    else:
        img.save(path, format="JPEG")
    return path


def test_targets_under_dest_folder(tmp_path: Path) -> None:
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


def test_unsorted_for_no_name_files(tmp_path: Path) -> None:
    src = tmp_path / "source"
    dst = tmp_path / "dest"
    src.mkdir()
    dst.mkdir()

    (src / "IMG_2034.jpg").write_text("fake image", encoding="utf-8")
    (src / "DSC_0012.png").write_text("fake image", encoding="utf-8")

    plan = build_plan(src, dst)
    assert len(plan) == 2
    for m in plan:
        assert m.folder == "Unsorted"
        assert m.matched_by == "Unsorted"
        assert m.target == dst / "Unsorted" / m.source.name
        assert m.status == "ready"


def test_collision_resolution_on_disk_and_plan(tmp_path: Path) -> None:
    src = tmp_path / "source"
    dst = tmp_path / "dest"
    src.mkdir()
    dst.mkdir()

    # Pre-existing file in destination
    nyc_dir = dst / "nyc"
    nyc_dir.mkdir(parents=True)
    (nyc_dir / "nyc.jpg").write_text("already there", encoding="utf-8")

    # Source has nyc.jpg which would collide with existing disk file
    (src / "nyc.jpg").write_text("new photo", encoding="utf-8")

    plan = build_plan(src, dst)
    assert len(plan) == 1
    # First collision should get " (1)"
    assert plan[0].target == dst / "nyc" / "nyc (1).jpg"
    assert plan[0].status == "ready"


def test_subfolders_ignored(tmp_path: Path) -> None:
    src = tmp_path / "source"
    dst = tmp_path / "dest"
    src.mkdir()
    dst.mkdir()

    (src / "top.jpg").write_text("top level", encoding="utf-8")
    sub = src / "nested_subfolder"
    sub.mkdir()
    (sub / "inside_sub.jpg").write_text("nested", encoding="utf-8")

    plan = build_plan(src, dst)
    assert len(plan) == 1
    assert plan[0].source.name == "top.jpg"


def test_dest_inside_source_refused(tmp_path: Path) -> None:
    src = tmp_path / "source"
    src.mkdir()
    dst = src / "nested_dest"
    dst.mkdir()

    with pytest.raises(ValueError, match="Destination folder cannot be inside source folder"):
        build_plan(src, dst)


def test_source_inside_dest_refused(tmp_path: Path) -> None:
    dst = tmp_path / "dest"
    dst.mkdir()
    src = dst / "nested_source"
    src.mkdir()

    with pytest.raises(ValueError, match="Source folder cannot be inside destination folder"):
        build_plan(src, dst)


def test_same_folder_refused(tmp_path: Path) -> None:
    src = tmp_path / "source"
    src.mkdir()

    with pytest.raises(ValueError, match="Destination folder cannot be the same as source folder"):
        build_plan(src, src)


def test_unknown_extensions_skipped(tmp_path: Path) -> None:
    src = tmp_path / "source"
    dst = tmp_path / "dest"
    src.mkdir()
    dst.mkdir()

    (src / "notes.txt").write_text("notes", encoding="utf-8")
    (src / "photo.jpg").write_text("photo", encoding="utf-8")
    (src / "table.csv").write_text("csv", encoding="utf-8")

    plan = build_plan(src, dst)
    assert len(plan) == 3

    txt_move = next(m for m in plan if m.source.name == "notes.txt")
    assert txt_move.status == "skipped"
    assert txt_move.matched_by == "Skipped (not an image or video)"

    csv_move = next(m for m in plan if m.source.name == "table.csv")
    assert csv_move.status == "skipped"
    assert csv_move.matched_by == "Skipped (not an image or video)"

    jpg_move = next(m for m in plan if m.source.name == "photo.jpg")
    assert jpg_move.status == "ready"


def test_dated_image_no_name_goes_to_date_folder(tmp_path: Path) -> None:
    src = tmp_path / "source"
    dst = tmp_path / "dest"
    src.mkdir()
    dst.mkdir()

    img_path = _create_image_with_date(src / "IMG_2034.jpg", "2019:07:14 12:00:00")
    plan = build_plan(src, dst)

    assert len(plan) == 1
    move = plan[0]
    assert move.folder == "2019/2019-07"
    assert move.matched_by == "Date: 2019-07"
    assert move.target == dst / "2019" / "2019-07" / "IMG_2034.jpg"
    assert move.status == "ready"


def test_named_image_with_date_goes_to_name_folder(tmp_path: Path) -> None:
    src = tmp_path / "source"
    dst = tmp_path / "dest"
    src.mkdir()
    dst.mkdir()

    # Even though it has a capture date, the name rule takes precedence
    img_path = _create_image_with_date(src / "nyc_sunset.jpg", "2019:07:14 12:00:00")
    plan = build_plan(src, dst)

    assert len(plan) == 1
    move = plan[0]
    assert move.folder == "nyc"
    assert move.matched_by == "Name: nyc"
    assert move.target == dst / "nyc" / "nyc_sunset.jpg"
    assert move.status == "ready"


def test_undated_unnamed_image_goes_to_unsorted(tmp_path: Path) -> None:
    src = tmp_path / "source"
    dst = tmp_path / "dest"
    src.mkdir()
    dst.mkdir()

    _create_image_with_date(src / "IMG_9999.jpg", date_str=None)
    plan = build_plan(src, dst)

    assert len(plan) == 1
    move = plan[0]
    assert move.folder == "Unsorted"
    assert move.matched_by == "Unsorted"
    assert move.target == dst / "Unsorted" / "IMG_9999.jpg"
    assert move.status == "ready"


def test_video_with_no_name_goes_to_unsorted(tmp_path: Path) -> None:
    src = tmp_path / "source"
    dst = tmp_path / "dest"
    src.mkdir()
    dst.mkdir()

    vid_path = src / "VID_1234.mp4"
    vid_path.write_bytes(b"dummy video content")
    plan = build_plan(src, dst)

    assert len(plan) == 1
    move = plan[0]
    assert move.folder == "Unsorted"
    assert move.matched_by == "Unsorted"
    assert move.target == dst / "Unsorted" / "VID_1234.mp4"
    assert move.status == "ready"
