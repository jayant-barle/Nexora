"""Plan generation for moving files in Nexora."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from nexora.names import extract_name, is_image_or_video


@dataclass
class PlannedMove:
    source: Path
    target: Path
    folder: str
    matched_by: str
    size: int
    status: str  # "ready", "skipped", "refused"
    reason: str = ""


def is_same_drive(p1: Path, p2: Path) -> bool:
    """Check if two paths are on the same filesystem drive."""
    try:
        return p1.resolve().drive.lower() == p2.resolve().drive.lower()
    except Exception:
        return True


def resolve_collision(target_dir: Path, filename: str, reserved_targets: set[Path]) -> Path:
    """Resolve filename collisions by adding numeric suffixes (1), (2), etc."""
    dot_idx = filename.rfind(".")
    if dot_idx != -1:
        stem = filename[:dot_idx]
        ext = filename[dot_idx:]
    else:
        stem = filename
        ext = ""

    candidate = target_dir / filename
    counter = 1
    while candidate.resolve() in reserved_targets or candidate.exists():
        candidate = target_dir / f"{stem} ({counter}){ext}"
        counter += 1

    reserved_targets.add(candidate.resolve())
    return candidate


def build_plan(source: Path, dest: Path) -> list[PlannedMove]:
    """Build the list of planned moves from source to dest.
    
    Pure function: scans top level of source, creates no files or directories.
    """
    source_resolved = source.resolve()
    dest_resolved = dest.resolve()

    if not source.exists():
        raise ValueError(f"Source folder does not exist: {source}")
    if not source.is_dir():
        raise ValueError(f"Source path is not a directory: {source}")

    if dest_resolved == source_resolved:
        raise ValueError("Destination folder cannot be the same as source folder.")

    try:
        if dest_resolved.is_relative_to(source_resolved):
            raise ValueError("Destination folder cannot be inside source folder.")
    except ValueError as e:
        if "Destination folder cannot be inside" in str(e):
            raise

    try:
        if source_resolved.is_relative_to(dest_resolved):
            raise ValueError("Source folder cannot be inside destination folder.")
    except ValueError as e:
        if "Source folder cannot be inside" in str(e):
            raise

    planned_moves: list[PlannedMove] = []
    reserved_targets: set[Path] = set()

    # Scan only top-level files in source, ignore subfolders
    entries = sorted([p for p in source.iterdir() if p.is_file()], key=lambda p: p.name.lower())

    for file_path in entries:
        try:
            size = file_path.stat().st_size
        except OSError:
            size = 0

        if not is_image_or_video(file_path.name):
            planned_moves.append(
                PlannedMove(
                    source=file_path,
                    target=file_path,
                    folder="",
                    matched_by="Skipped (not an image or video)",
                    size=size,
                    status="skipped",
                    reason="Not an image or video file",
                )
            )
            continue

        name = extract_name(file_path.name)
        if name:
            folder_name = name
            matched_by = f"Name: {name}"
        else:
            folder_name = "Unsorted"
            matched_by = "Unsorted"

        target_dir = dest / folder_name
        target_path = resolve_collision(target_dir, file_path.name, reserved_targets)

        if not is_same_drive(file_path, target_path):
            planned_moves.append(
                PlannedMove(
                    source=file_path,
                    target=target_path,
                    folder=folder_name,
                    matched_by=matched_by,
                    size=size,
                    status="refused",
                    reason="Cross-drive move refused in stage 1",
                )
            )
        else:
            planned_moves.append(
                PlannedMove(
                    source=file_path,
                    target=target_path,
                    folder=folder_name,
                    matched_by=matched_by,
                    size=size,
                    status="ready",
                    reason="",
                )
            )

    return planned_moves
