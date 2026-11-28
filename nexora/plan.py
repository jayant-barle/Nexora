"""Plan generation for moving files in Nexora."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from nexora.names import extract_name, is_image_or_video, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS
from nexora.metadata import capture_date
from nexora.faces.people import to_folder_name


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
        return False


def resolve_collision(
    target_dir: Path,
    filename: str,
    reserved_targets: set[Path],
    counters: dict[tuple[Path, str, str], int] | None = None,
) -> Path:
    """Resolve filename collisions by adding numeric suffixes (1), (2), etc."""
    dot_idx = filename.rfind(".")
    if dot_idx != -1:
        stem = filename[:dot_idx]
        ext = filename[dot_idx:]
    else:
        stem = filename
        ext = ""

    if counters is None:
        counters = {}

    key = (target_dir, stem, ext)

    if key in counters:
        counter = counters[key]
        candidate = target_dir / f"{stem} ({counter}){ext}"
    else:
        candidate = target_dir / filename
        if candidate.resolve() not in reserved_targets and not candidate.exists():
            reserved_targets.add(candidate.resolve())
            counters[key] = 1
            return candidate
        counter = 1
        candidate = target_dir / f"{stem} ({counter}){ext}"

    while candidate.resolve() in reserved_targets or candidate.exists():
        counter += 1
        candidate = target_dir / f"{stem} ({counter}){ext}"

    reserved_targets.add(candidate.resolve())
    counters[key] = counter + 1
    return candidate


def _build_norm_path_lookup(mapping: dict[str, Any] | None) -> dict[str, Any]:
    """Normalize full-path keys cleanly using os.path.normcase while preserving exact fallback keys."""
    if not mapping:
        return {}
    return {os.path.normcase(k): v for k, v in mapping.items()}


def _lookup_path_entry(
    mapping: dict[str, Any] | None,
    norm_mapping: dict[str, Any],
    file_path: Path,
    resolved_str: str,
) -> Any:
    if not mapping:
        return None
    norm_res = os.path.normcase(resolved_str)
    norm_raw = os.path.normcase(str(file_path))
    if norm_res in norm_mapping:
        return norm_mapping[norm_res]
    if norm_raw in norm_mapping:
        return norm_mapping[norm_raw]
    # Basename-only lookup is allowed strictly for synthetic basename-only keys (no path separators)
    bare = mapping.get(file_path.name)
    if bare is not None:
        return bare
    return None


def build_plan(
    source: Path,
    dest: Path,
    face_map: dict[str, str | None] | None = None,
    face_data: dict[str, Any] | None = None,
) -> list[PlannedMove]:
    """Build the list of planned moves from source to dest.
    
    Pure function: scans top level of source, creates no files or directories.
    
    Stage 4 rules:
    Images:
      1. Exactly 1 face belonging to a named person -> <dest>/<Person>/<filename>, matched_by = "Person: <Name>"
      2. 2+ faces belonging to different named people -> <dest>/Group photos/<filename>, matched_by = "Group photos"
      3. Name in file name -> <dest>/<name>/<filename>, matched_by = "Name: <name>"
      4. Metadata date -> <dest>/<YYYY>/<YYYY-MM>/<filename>, matched_by = "Date: <YYYY-MM>"
      5. Otherwise -> <dest>/Unsorted/<filename>, matched_by = "Unsorted"
    Videos:
      1. Named person appears in >= 2 of 5 sampled frames -> <dest>/<Person>/<filename>, matched_by = "Person: <Name>"
      2. Name in file name -> <dest>/<name>/<filename>, matched_by = "Name: <name>"
      3. Otherwise -> <dest>/Unsorted/<filename>, matched_by = "Unsorted"
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
    collision_counters: dict[tuple[Path, str, str], int] = {}
    norm_face_data = _build_norm_path_lookup(face_data)
    norm_face_map = _build_norm_path_lookup(face_map)

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

        resolved_str = str(file_path.resolve())
        is_video = file_path.suffix.lower() in VIDEO_EXTENSIONS

        # Check if Stage 4 face_data is provided
        if face_data is not None:
            file_face_info = _lookup_path_entry(face_data, norm_face_data, file_path, resolved_str)

            if is_video:
                # Video placement in Stage 4
                video_person = file_face_info.get("video_person") if file_face_info else None
                if video_person:
                    f_name = to_folder_name(video_person)
                    folder_rel = Path(f_name)
                    folder_name = f_name
                    matched_by = f"Person: {video_person}"
                else:
                    name = extract_name(file_path.name)
                    if name:
                        folder_rel = Path(name)
                        folder_name = name
                        matched_by = f"Name: {name}"
                    else:
                        folder_rel = Path("Unsorted")
                        folder_name = "Unsorted"
                        matched_by = "Unsorted"
            else:
                # Image placement: Stage 4 / FIX 1
                # 1. Exactly 1 face belonging to a visible named group -> <Person>/
                # 2. 2+ faces belonging to different visible named groups -> Group photos/
                # 3. Otherwise fall through: name in file name -> <name>/
                # 4. Otherwise EXIF date -> <YYYY>/<YYYY-MM>/
                # 5. Otherwise -> Unsorted/
                faces_list = file_face_info.get("faces") if file_face_info else None
                matched_face = False
                folder_rel = Path("Unsorted")
                folder_name = "Unsorted"
                matched_by = "Unsorted"

                # Filter for visible named faces (None represents unnamed visible faces)
                named_faces = [f for f in (faces_list or []) if f is not None]
                unique_named = set(named_faces)

                if len(unique_named) >= 2:
                    # 2 or more faces belonging to different visible named groups
                    folder_rel = Path("Group photos")
                    folder_name = "Group photos"
                    matched_by = "Group photos"
                    matched_face = True
                elif len(unique_named) == 1:
                    # Exactly one visible named group
                    p_name = list(unique_named)[0]
                    f_name = to_folder_name(p_name)
                    folder_rel = Path(f_name)
                    folder_name = f_name
                    matched_by = f"Person: {p_name}"
                    matched_face = True

                if not matched_face:
                    # Fallback to name rule
                    name = extract_name(file_path.name)
                    if name:
                        folder_rel = Path(name)
                        folder_name = name
                        matched_by = f"Name: {name}"
                    else:
                        # Fallback to date rule
                        date_val = capture_date(file_path)
                        if date_val is not None:
                            year_str = f"{date_val.year:04d}"
                            month_str = f"{date_val.year:04d}-{date_val.month:02d}"
                            folder_rel = Path(year_str) / month_str
                            folder_name = f"{year_str}/{month_str}"
                            matched_by = f"Date: {month_str}"
                        else:
                            folder_rel = Path("Unsorted")
                            folder_name = "Unsorted"
                            matched_by = "Unsorted"

        else:
            # Stage 3 fallback (face_map or no face data)
            name = extract_name(file_path.name)
            if name:
                folder_rel = Path(name)
                folder_name = name
                matched_by = f"Name: {name}"
            else:
                date_val = None
                if file_path.suffix.lower() in IMAGE_EXTENSIONS:
                    date_val = capture_date(file_path)

                if date_val is not None:
                    year_str = f"{date_val.year:04d}"
                    month_str = f"{date_val.year:04d}-{date_val.month:02d}"
                    folder_rel = Path(year_str) / month_str
                    folder_name = f"{year_str}/{month_str}"
                    matched_by = f"Date: {month_str}"
                else:
                    face_person = None
                    if face_map and file_path.suffix.lower() in IMAGE_EXTENSIONS:
                        face_person = _lookup_path_entry(face_map, norm_face_map, file_path, resolved_str)

                    if face_person:
                        folder_rel = Path(face_person)
                        folder_name = face_person
                        matched_by = f"Face: {face_person}"
                    else:
                        folder_rel = Path("Unsorted")
                        folder_name = "Unsorted"
                        matched_by = "Unsorted"

        target_dir = dest / folder_rel
        target_path = resolve_collision(target_dir, file_path.name, reserved_targets, collision_counters)

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
