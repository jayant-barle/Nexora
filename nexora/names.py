"""Name extraction and supported media definitions for Nexora."""

from __future__ import annotations

import re

IMAGE_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".heic", ".webp", ".bmp", ".tif", ".tiff", ".gif"
}

VIDEO_EXTENSIONS = {
    ".mp4", ".mov", ".avi", ".mkv", ".m4v", ".wmv", ".3gp"
}

SUPPORTED_EXTENSIONS = IMAGE_EXTENSIONS | VIDEO_EXTENSIONS

CAMERA_TOKENS = {
    "img", "dsc", "vid", "mov", "screenshot", "whatsapp", "image"
}

GENERIC_TOKENS = {
    "photo", "photos", "pic", "pics", "picture", "copy", "new", "final",
    "untitled", "download", "downloads", "video", "clip", "film",
}

FILLER_TOKENS = {
    "of", "the", "and", "a", "an", "to", "in", "on", "at", "for", "with", "from",
}

WINDOWS_RESERVED_NAMES = {
    "con", "prn", "aux", "nul",
    "com", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
    "lpt", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
}


def is_image_or_video(filename: str) -> bool:
    """Check if filename has a supported image or video extension."""
    dot_idx = filename.rfind(".")
    if dot_idx == -1:
        return False
    ext = filename[dot_idx:].lower()
    return ext in SUPPORTED_EXTENSIONS


def extract_name(filename: str) -> str | None:
    """Extract person or place name token from filename according to Stage 1 rules."""
    dot_idx = filename.rfind(".")
    if dot_idx == -1:
        return None
    stem = filename[:dot_idx]
    if not stem:
        return None

    # Check if the raw stem is a Windows reserved name directly
    if stem.lower() in WINDOWS_RESERVED_NAMES:
        return None

    # Split on whitespace, _, -, ., and digits
    raw_tokens = re.split(r"[\s_\-.\d]+", stem)

    # Lowercase and filter out empty tokens
    tokens = [t.lower() for t in raw_tokens if t]

    # Drop camera tokens anywhere in the list
    tokens = [t for t in tokens if t not in CAMERA_TOKENS]

    # Drop generic and filler tokens anywhere in the list
    tokens = [t for t in tokens if t not in GENERIC_TOKENS and t not in FILLER_TOKENS]

    if not tokens:
        return None

    candidate = tokens[0]

    # Check if candidate is a Windows reserved name
    if candidate in WINDOWS_RESERVED_NAMES:
        return None

    return candidate
