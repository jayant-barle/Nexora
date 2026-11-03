"""Image metadata extraction for Nexora."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

from PIL import Image

try:
    from pillow_heif import register_heif_opener
    register_heif_opener()
except Exception:
    pass

from nexora.names import IMAGE_EXTENSIONS

EXIF_DATETIME_ORIGINAL_TAG = 36867
EXIF_IFD_TAG = 0x8769


def capture_date(path: Path) -> datetime | None:
    """Read the EXIF DateTimeOriginal tag (tag 36867) from an image file.

    Returns datetime or None if missing, unparseable, or not an image.
    Never raises to the caller.
    Never uses file created, modified, or access times.
    Never writes to or changes the image file.
    """
    try:
        path_obj = Path(path)
        ext = path_obj.suffix.lower()
        if ext not in IMAGE_EXTENSIONS:
            return None

        with Image.open(path_obj) as img:
            exif = img.getexif()
            if not exif:
                return None

            raw_val = exif.get(EXIF_DATETIME_ORIGINAL_TAG)
            if not raw_val:
                try:
                    ifd = exif.get_ifd(EXIF_IFD_TAG)
                    raw_val = ifd.get(EXIF_DATETIME_ORIGINAL_TAG)
                except Exception:
                    raw_val = None

            if not raw_val or not isinstance(raw_val, str):
                return None

            return datetime.strptime(raw_val.strip(), "%Y:%m:%d %H:%M:%S")
    except Exception:
        return None
