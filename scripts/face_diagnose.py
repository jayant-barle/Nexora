"""Diagnostic tool to compare face detection recall before and after improvements."""

from __future__ import annotations

import sys
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import cv2
import numpy as np

from nexora.names import extract_name, is_image_or_video, IMAGE_EXTENSIONS
from nexora.metadata import capture_date
from nexora.faces.detect import (
    detect_faces,
    get_detector,
    read_image_bgr,
)


def detect_faces_baseline(image_path: Path | str) -> list[np.ndarray]:
    """Baseline detector: score threshold 0.8, no EXIF transpose, no rotation, no multi-scale."""
    try:
        img = read_image_bgr(image_path, apply_exif_transpose=False)
        if img is None:
            return []
        h, w = img.shape[:2]
        if h <= 0 or w <= 0:
            return []
        detector = get_detector(score_threshold=0.8)
        if detector is None:
            return []
        detector.setInputSize((w, h))
        _, faces = detector.detect(img)
        if faces is None or len(faces) == 0:
            return []
        return [face for face in faces]
    except Exception:
        return []


def run_diagnose(folder_path: Path) -> dict[str, int]:
    """Scan folder for unnamed, undated images and compare baseline vs improved detection."""
    images = []
    for p in sorted(folder_path.iterdir(), key=lambda x: x.name.lower()):
        if not p.is_file():
            continue
        if p.suffix.lower() not in IMAGE_EXTENSIONS:
            continue
        if not is_image_or_video(p.name):
            continue
        # Scope: only images with no name and no date
        if extract_name(p.name) is not None:
            continue
        if capture_date(p) is not None:
            continue
        images.append(p)

    total_checked = len(images)
    total_before = 0
    total_after = 0

    print(f"Scanning {total_checked} unnamed, undated images in: {folder_path}\n")
    print(f"{'Filename':<35} | {'Current (0.8)':<15} | {'Improved (0.6 + tuned)':<20}")
    print("-" * 76)

    for img in images:
        before = detect_faces_baseline(img)
        after = detect_faces(img)

        count_before = len(before)
        count_after = len(after)

        total_before += count_before
        total_after += count_after

        print(f"{img.name:<35} | {count_before:<15} | {count_after:<20}")

    print("-" * 76)
    print(f"Summary:")
    print(f"  Images checked:     {total_checked}")
    print(f"  Faces found before: {total_before}")
    print(f"  Faces found after:  {total_after}")

    return {
        "images_checked": total_checked,
        "faces_before": total_before,
        "faces_after": total_after,
    }


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python scripts/face_diagnose.py <folder_path>")
        print("Scans a folder for unnamed, undated images and prints face detection comparisons.")
        sys.exit(0)

    target_dir = Path(sys.argv[1])
    if not target_dir.exists() or not target_dir.is_dir():
        print(f"Error: Folder does not exist: {target_dir}")
        sys.exit(1)

    run_diagnose(target_dir)


if __name__ == "__main__":
    main()
