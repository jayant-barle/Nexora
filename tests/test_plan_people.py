"""Tests for Stage 4 placement rules: Person, Group photos, Name, Date, Unsorted hierarchy."""

from pathlib import Path
from PIL import Image

from nexora.plan import build_plan


def _create_plain_image(path: Path) -> None:
    img = Image.new("RGB", (64, 64), color=(100, 100, 100))
    img.save(path)


def _create_exif_image(path: Path, date_str: str) -> None:
    img = Image.new("RGB", (64, 64), color="green")
    exif = img.getexif()
    exif[36867] = date_str
    img.save(path, "JPEG", exif=exif)


def test_person_beats_name_and_date(tmp_path: Path):
    """An image with a known person goes to <Person>/, overriding name and date rules."""
    src = tmp_path / "src"
    dst = tmp_path / "dst"
    src.mkdir()
    dst.mkdir()

    img_file = src / "nyc_ali.jpg"
    _create_exif_image(img_file, "2023:06:15 12:00:00")

    face_data = {
        str(img_file.resolve()): {"faces": ["Ali"]}
    }

    plan = build_plan(src, dst, face_data=face_data)
    assert len(plan) == 1
    assert plan[0].status == "ready"
    assert plan[0].folder == "ali"
    assert plan[0].matched_by == "Person: Ali"
    assert plan[0].target == dst / "ali" / "nyc_ali.jpg"


def test_two_known_people_go_to_group_photos(tmp_path: Path):
    """Two or more known people go to Group photos even if filename has a name."""
    src = tmp_path / "src"
    dst = tmp_path / "dst"
    src.mkdir()
    dst.mkdir()

    img_file = src / "paris_vacation.jpg"
    _create_plain_image(img_file)

    face_data = {
        str(img_file.resolve()): {"faces": ["Alice", "Bob"]}
    }

    plan = build_plan(src, dst, face_data=face_data)
    assert len(plan) == 1
    assert plan[0].status == "ready"
    assert plan[0].folder == "Group photos"
    assert plan[0].matched_by == "Group photos"
    assert plan[0].target == dst / "Group photos" / "paris_vacation.jpg"


def test_unnamed_person_goes_to_unsorted(tmp_path: Path):
    """An image showing an unnamed person goes to Unsorted when it has no name or EXIF date."""
    src = tmp_path / "src"
    dst = tmp_path / "dst"
    src.mkdir()
    dst.mkdir()

    img_file = src / "IMG_0042.jpg"
    _create_plain_image(img_file)

    face_data = {
        str(img_file.resolve()): {"faces": [None]}  # Unnamed face
    }

    plan = build_plan(src, dst, face_data=face_data)
    assert len(plan) == 1
    assert plan[0].status == "ready"
    assert plan[0].folder == "Unsorted"
    assert plan[0].matched_by == "Unsorted"
    assert plan[0].target == dst / "Unsorted" / "IMG_0042.jpg"


def test_unnamed_face_with_name_in_file_name_goes_to_name_folder(tmp_path: Path):
    """An unnamed face does not block the name rule: tokyo_beach.jpg goes to tokyo/."""
    src = tmp_path / "src"
    dst = tmp_path / "dst"
    src.mkdir()
    dst.mkdir()

    img_file = src / "tokyo_beach.jpg"
    _create_plain_image(img_file)

    face_data = {
        str(img_file.resolve()): {"faces": [None]}  # Unnamed face
    }

    plan = build_plan(src, dst, face_data=face_data)
    assert len(plan) == 1
    assert plan[0].status == "ready"
    assert plan[0].folder == "tokyo"
    assert plan[0].matched_by == "Name: tokyo"
    assert plan[0].target == dst / "tokyo" / "tokyo_beach.jpg"


def test_hidden_one_face_group_with_name_goes_to_name_folder(tmp_path: Path):
    """A face from a hidden 1-face group is treated as no face and does not block the name rule."""
    from nexora.faces.groups import FaceClusterManager
    from nexora.faces.people import PeopleManager

    src = tmp_path / "src"
    dst = tmp_path / "dst"
    src.mkdir()
    dst.mkdir()

    img_file = src / "paris_holiday.jpg"
    _create_plain_image(img_file)

    json_path = tmp_path / "faces.json"
    cm = FaceClusterManager(json_path=json_path)
    cm.groups = [{"id": "group_001", "name": "charlie", "display_name": "Charlie"}]
    cm.file_groups = {str(img_file.resolve()): ["group_001"]}  # Only 1 face in library -> hidden!
    pm = PeopleManager(cm)

    face_data = pm.get_face_data_for_plan()
    # Hidden group must be treated as no face
    assert face_data[str(img_file.resolve())]["faces"] == []

    plan = build_plan(src, dst, face_data=face_data)
    assert len(plan) == 1
    assert plan[0].status == "ready"
    assert plan[0].folder == "paris"
    assert plan[0].matched_by == "Name: paris"
    assert plan[0].target == dst / "paris" / "paris_holiday.jpg"


def test_one_named_face_plus_one_unnamed_face_goes_to_person_folder(tmp_path: Path):
    """One named face + one unnamed face goes to the named person folder."""
    src = tmp_path / "src"
    dst = tmp_path / "dst"
    src.mkdir()
    dst.mkdir()

    img_file = src / "vacation_photo.jpg"
    _create_plain_image(img_file)

    face_data = {
        str(img_file.resolve()): {"faces": ["Alice", None]}  # One named, one unnamed
    }

    plan = build_plan(src, dst, face_data=face_data)
    assert len(plan) == 1
    assert plan[0].status == "ready"
    assert plan[0].folder == "alice"
    assert plan[0].matched_by == "Person: Alice"
    assert plan[0].target == dst / "alice" / "vacation_photo.jpg"


def test_two_named_faces_go_to_group_photos(tmp_path: Path):
    """Two named faces go to Group photos/ even if file has a name."""
    src = tmp_path / "src"
    dst = tmp_path / "dst"
    src.mkdir()
    dst.mkdir()

    img_file = src / "tokyo_outing.jpg"
    _create_plain_image(img_file)

    face_data = {
        str(img_file.resolve()): {"faces": ["Alice", "Bob"]}
    }

    plan = build_plan(src, dst, face_data=face_data)
    assert len(plan) == 1
    assert plan[0].status == "ready"
    assert plan[0].folder == "Group photos"
    assert plan[0].matched_by == "Group photos"
    assert plan[0].target == dst / "Group photos" / "tokyo_outing.jpg"


def test_named_image_with_no_face_follows_name_rule(tmp_path: Path):
    """A named image with no face detected falls through to the name rule."""
    src = tmp_path / "src"
    dst = tmp_path / "dst"
    src.mkdir()
    dst.mkdir()

    img_file = src / "nyc_sunset.jpg"
    _create_plain_image(img_file)

    face_data = {
        str(img_file.resolve()): {"faces": []}  # No face detected
    }

    plan = build_plan(src, dst, face_data=face_data)
    assert len(plan) == 1
    assert plan[0].status == "ready"
    assert plan[0].folder == "nyc"
    assert plan[0].matched_by == "Name: nyc"
    assert plan[0].target == dst / "nyc" / "nyc_sunset.jpg"


def test_video_with_person_in_2_of_5_frames_goes_to_person_folder(tmp_path: Path):
    """A video where a named person appears in >= 2 of 5 frames goes to <Person>/."""
    src = tmp_path / "src"
    dst = tmp_path / "dst"
    src.mkdir()
    dst.mkdir()

    video_file = src / "VID_2024.mp4"
    video_file.write_bytes(b"dummy video data")

    face_data = {
        str(video_file.resolve()): {"video_person": "Charlie"}
    }

    plan = build_plan(src, dst, face_data=face_data)
    assert len(plan) == 1
    assert plan[0].status == "ready"
    assert plan[0].folder == "charlie"
    assert plan[0].matched_by == "Person: Charlie"
    assert plan[0].target == dst / "charlie" / "VID_2024.mp4"


def test_video_with_person_in_only_1_frame_does_not_go_to_person_folder(tmp_path: Path):
    """A video where person appears in only 1 frame falls through to name or Unsorted."""
    src = tmp_path / "src"
    dst = tmp_path / "dst"
    src.mkdir()
    dst.mkdir()

    # Video with name token
    vid1 = src / "paris_walk.mp4"
    vid1.write_bytes(b"dummy video data 1")

    # Video without name token
    vid2 = src / "VID_0099.mp4"
    vid2.write_bytes(b"dummy video data 2")

    # In 1 frame only: video_person is None (does not qualify)
    face_data = {
        str(vid1.resolve()): {"video_person": None},
        str(vid2.resolve()): {"video_person": None},
    }

    plan = build_plan(src, dst, face_data=face_data)
    assert len(plan) == 2

    m1 = next(m for m in plan if m.source.name == "paris_walk.mp4")
    assert m1.folder == "paris"
    assert m1.matched_by == "Name: paris"

    m2 = next(m for m in plan if m.source.name == "VID_0099.mp4")
    assert m2.folder == "Unsorted"
    assert m2.matched_by == "Unsorted"
