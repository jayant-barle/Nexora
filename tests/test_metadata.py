"""Unit tests for nexora.metadata capture_date."""

from datetime import datetime
import os
from pathlib import Path
from PIL import Image
import pytest

from nexora.metadata import capture_date


def _create_test_image(path: Path, date_str: str | None = None) -> Path:
    """Create a minimal synthetic JPEG image with optional EXIF DateTimeOriginal."""
    img = Image.new("RGB", (20, 20), color="blue")
    if date_str:
        exif = img.getexif()
        exif[36867] = date_str
        img.save(path, format="JPEG", exif=exif)
    else:
        img.save(path, format="JPEG")
    return path


def test_image_with_datetime_original(tmp_path: Path) -> None:
    img_path = _create_test_image(tmp_path / "img_with_date.jpg", "2019:07:14 12:00:00")
    dt = capture_date(img_path)
    assert dt == datetime(2019, 7, 14, 12, 0, 0)


def test_image_with_no_exif(tmp_path: Path) -> None:
    img_path = _create_test_image(tmp_path / "img_no_exif.jpg")
    assert capture_date(img_path) is None


def test_corrupt_image_returns_none_and_does_not_raise(tmp_path: Path) -> None:
    corrupt_path = tmp_path / "corrupt.jpg"
    corrupt_path.write_bytes(b"\xff\xd8\xff\xe0 corrupted garbage data")
    assert capture_date(corrupt_path) is None


def test_video_file_returns_none(tmp_path: Path) -> None:
    video_path = tmp_path / "clip.mp4"
    video_path.write_bytes(b"fake video binary stream")
    assert capture_date(video_path) is None


def test_modified_time_does_not_change_result(tmp_path: Path) -> None:
    img_path = _create_test_image(tmp_path / "test_mtime.jpg", "2019:07:14 12:00:00")
    # Change file modified and access timestamps to another year (2025)
    future_time = datetime(2025, 1, 1, 0, 0, 0).timestamp()
    os.utime(img_path, (future_time, future_time))

    # capture_date must strictly read EXIF DateTimeOriginal, ignoring filesystem timestamps
    dt = capture_date(img_path)
    assert dt == datetime(2019, 7, 14, 12, 0, 0)


def test_heic_image_with_datetime_original(tmp_path: Path) -> None:
    try:
        from pillow_heif import register_heif_opener
        register_heif_opener()
    except Exception as e:
        pytest.skip(f"pillow_heif not available: {e}")

    heic_path = tmp_path / "iphone_photo.heic"
    img = Image.new("RGB", (20, 20), color="yellow")
    exif = img.getexif()
    exif[36867] = "2023:05:20 14:30:00"

    try:
        img.save(heic_path, format="HEIF", exif=exif)
    except Exception as e:
        pytest.skip(f"pillow_heif cannot write HEIC on this machine: {e}")

    dt = capture_date(heic_path)
    assert dt == datetime(2023, 5, 20, 14, 30, 0)
