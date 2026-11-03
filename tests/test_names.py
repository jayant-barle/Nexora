"""Unit tests for nexora.names extract_name rule."""

import pytest
from nexora.names import extract_name, is_image_or_video


@pytest.mark.parametrize(
    ("filename", "expected"),
    [
        ("nyc.jpg", "nyc"),
        ("nyc_2019_sunset.jpg", "nyc"),
        ("nyc_ali.jpg", "nyc"),
        ("paris_eiffel_tower.mp4", "paris"),
        ("IMG_2034.jpg", None),
        ("DSC_0012.png", None),
        ("VID_20240101_120000.mp4", None),
        ("Screenshot 2026-11-04.png", None),
        ("WhatsApp Image 2024-05-10.jpeg", None),
        ("2026_11_04.mp4", None),
        ("con.jpg", None),
        ("___.jpg", None),
        # Additional edge cases
        ("prn.png", None),
        ("aux.mp4", None),
        ("nul.gif", None),
        ("com1.webp", None),
        ("lpt2.jpg", None),
        ("no_extension", None),
        (".hidden.jpg", "hidden"),
        ("---.jpg", None),
        ("12345.mp4", None),
        ("vid_9999.mov", None),
        ("MOV_4321.MOV", None),
        ("image 99.webp", None),
        ("tokyo-trip-2025.heic", "tokyo"),
        # Generic tokens
        ("photo_01.jpg", None),
        ("photo_nyc.jpg", "nyc"),
        ("pic_2024_ali.jpg", "ali"),
        ("copy_of_nyc.jpg", "nyc"),
        ("final_paris_trip.mp4", "paris"),
        ("new.png", None),
        ("untitled.jpg", None),
        ("download_2.jpg", None),
        # Filler tokens
        ("the_beach.jpg", "beach"),
        ("nyc_and_ali.jpg", "nyc"),
        ("a_trip.jpg", "trip"),
    ],
)
def test_extract_name_rule(filename: str, expected: str | None) -> None:
    assert extract_name(filename) == expected


@pytest.mark.parametrize(
    ("filename", "expected"),
    [
        ("photo.jpg", True),
        ("photo.JPEG", True),
        ("pic.png", True),
        ("pic.heic", True),
        ("pic.webp", True),
        ("clip.mp4", True),
        ("clip.mov", True),
        ("clip.mkv", True),
        ("doc.txt", False),
        ("data.csv", False),
        ("app.py", False),
        ("archive.zip", False),
    ],
)
def test_is_image_or_video(filename: str, expected: bool) -> None:
    assert is_image_or_video(filename) == expected
