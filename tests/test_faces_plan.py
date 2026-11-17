"""Tests for plan hierarchy order with face recognition."""

from pathlib import Path
from PIL import Image

from nexora.plan import build_plan


def _create_exif_image(path: Path, date_str: str) -> None:
    """Create a minimal JPEG with EXIF DateTimeOriginal."""
    img = Image.new("RGB", (64, 64), color="blue")
    exif = img.getexif()
    exif[36867] = date_str
    img.save(path, "JPEG", exif=exif)


def _create_plain_image(path: Path) -> None:
    """Create a minimal image without EXIF."""
    img = Image.new("RGB", (64, 64), color=(100, 100, 100))
    img.save(path)


def test_name_beats_face(tmp_path: Path):
    """An image with a name token goes to the name folder, even if a face matches."""
    src = tmp_path / "src"
    dst = tmp_path / "dst"
    src.mkdir()
    dst.mkdir()

    img_file = src / "nyc_IMG_1234.jpg"
    _create_plain_image(img_file)

    face_map = {str(img_file.resolve()): "alice"}
    plan = build_plan(src, dst, face_map=face_map)

    assert len(plan) == 1
    assert plan[0].status == "ready"
    assert plan[0].folder == "nyc"
    assert plan[0].matched_by == "Name: nyc"
    assert plan[0].target == dst / "nyc" / "nyc_IMG_1234.jpg"


def test_date_beats_face(tmp_path: Path):
    """An unnamed image with EXIF date goes to the date folder, even if a face matches."""
    src = tmp_path / "src"
    dst = tmp_path / "dst"
    src.mkdir()
    dst.mkdir()

    img_file = src / "IMG_0001.jpg"
    _create_exif_image(img_file, "2023:05:20 14:30:00")

    face_map = {str(img_file.resolve()): "alice"}
    plan = build_plan(src, dst, face_map=face_map)

    assert len(plan) == 1
    assert plan[0].status == "ready"
    assert plan[0].folder == "2023/2023-05"
    assert plan[0].matched_by == "Date: 2023-05"
    assert plan[0].target == dst / "2023" / "2023-05" / "IMG_0001.jpg"


def test_face_only_when_no_name_and_no_date(tmp_path: Path):
    """An image with no name and no date goes to the face person folder when matched."""
    src = tmp_path / "src"
    dst = tmp_path / "dst"
    src.mkdir()
    dst.mkdir()

    img_file = src / "IMG_9999.jpg"
    _create_plain_image(img_file)

    face_map = {str(img_file.resolve()): "alice"}
    plan = build_plan(src, dst, face_map=face_map)

    assert len(plan) == 1
    assert plan[0].status == "ready"
    assert plan[0].folder == "alice"
    assert plan[0].matched_by == "Face: alice"
    assert plan[0].target == dst / "alice" / "IMG_9999.jpg"


def test_multi_person_image_goes_to_unsorted(tmp_path: Path):
    """An image with multiple people (face_map maps to None) goes to Unsorted."""
    src = tmp_path / "src"
    dst = tmp_path / "dst"
    src.mkdir()
    dst.mkdir()

    img_file = src / "IMG_0042.jpg"
    _create_plain_image(img_file)

    face_map = {str(img_file.resolve()): None}
    plan = build_plan(src, dst, face_map=face_map)

    assert len(plan) == 1
    assert plan[0].status == "ready"
    assert plan[0].folder == "Unsorted"
    assert plan[0].matched_by == "Unsorted"
    assert plan[0].target == dst / "Unsorted" / "IMG_0042.jpg"


def test_videos_never_use_faces(tmp_path: Path):
    """Videos never use faces; unnamed video goes to Unsorted even if in face_map."""
    src = tmp_path / "src"
    dst = tmp_path / "dst"
    src.mkdir()
    dst.mkdir()

    video_file = src / "VID_20240101.mp4"
    video_file.write_bytes(b"dummy video data")

    face_map = {str(video_file.resolve()): "alice"}
    plan = build_plan(src, dst, face_map=face_map)

    assert len(plan) == 1
    assert plan[0].status == "ready"
    assert plan[0].folder == "Unsorted"
    assert plan[0].matched_by == "Unsorted"
    assert plan[0].target == dst / "Unsorted" / "VID_20240101.mp4"


def test_videos_with_name_use_name_rule(tmp_path: Path):
    """Videos with name token follow name rule, ignoring any face_map."""
    src = tmp_path / "src"
    dst = tmp_path / "dst"
    src.mkdir()
    dst.mkdir()

    video_file = src / "paris_vacation.mp4"
    video_file.write_bytes(b"dummy video data")

    face_map = {str(video_file.resolve()): "alice"}
    plan = build_plan(src, dst, face_map=face_map)

    assert len(plan) == 1
    assert plan[0].status == "ready"
    assert plan[0].folder == "paris"
    assert plan[0].matched_by == "Name: paris"
    assert plan[0].target == dst / "paris" / "paris_vacation.mp4"
