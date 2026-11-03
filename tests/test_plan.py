"""Unit tests for nexora.plan build_plan."""

from pathlib import Path
import pytest

from nexora.plan import build_plan


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
