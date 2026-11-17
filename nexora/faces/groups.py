"""Face clustering, caching, and group management for Nexora."""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable
import cv2
import numpy as np

from nexora.names import extract_name, is_image_or_video, IMAGE_EXTENSIONS
from nexora.metadata import capture_date
from nexora.faces.detect import detect_faces
from nexora.faces.recognize import (
    DEFAULT_THRESHOLD,
    align_and_crop,
    cosine_similarity,
    embed_face,
    same_person,
)

RUNS_DIR = Path(__file__).resolve().parent.parent.parent / "runs"
DEFAULT_FACES_JSON = RUNS_DIR / "faces.json"
CROPS_DIR = RUNS_DIR / "face_crops"


def compute_file_sha256(path: Path) -> str:
    """Compute SHA-256 of a file using 1 MB chunks."""
    hasher = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(1024 * 1024):
            hasher.update(chunk)
    return hasher.hexdigest()


class FaceClusterManager:
    """Manages face cache, clustering into groups, group naming, and face mapping."""

    def __init__(self, json_path: Path | None = None) -> None:
        self.json_path = json_path or DEFAULT_FACES_JSON
        self.crops_dir = self.json_path.parent / "face_crops"
        self.cache: dict[str, dict] = {}
        self.groups: list[dict] = []
        self.file_groups: dict[str, list[str]] = {}
        self.load()

    def load(self) -> None:
        """Load state from JSON if it exists."""
        if not self.json_path.exists():
            return
        try:
            with open(self.json_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            self.cache = data.get("cache", {})
            self.groups = data.get("groups", [])
            self.file_groups = data.get("file_groups", {})
        except Exception:
            self.cache = {}
            self.groups = []
            self.file_groups = {}

    def save(self) -> None:
        """Save state to JSON."""
        self.json_path.parent.mkdir(parents=True, exist_ok=True)
        data = {
            "version": 1,
            "cache": self.cache,
            "groups": self.groups,
            "file_groups": self.file_groups,
        }
        with open(self.json_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

    def _find_matching_group(self, embedding: np.ndarray, threshold: float = DEFAULT_THRESHOLD) -> dict | None:
        """Find the group with highest cosine similarity >= threshold."""
        best_group = None
        best_sim = threshold
        for group in self.groups:
            rep = np.array(group.get("representative_embedding", []), dtype=np.float32)
            if rep.size == 0:
                continue
            sim = cosine_similarity(embedding, rep)
            if sim >= best_sim:
                best_sim = sim
                best_group = group
        return best_group

    def scan_source(
        self,
        source_dir: Path,
        threshold: float = DEFAULT_THRESHOLD,
        progress_callback: Callable[[int, int, int], None] | None = None,
    ) -> dict[str, int]:
        """Scan source folder for unnamed, undated images and cluster faces.
        
        Args:
            source_dir: Folder to scan.
            threshold: Cosine similarity threshold for clustering.
            progress_callback: Optional callable(scanned_images, total_images, total_faces).
            
        Returns:
            Dict summary with {"images_scanned": N, "faces_found": M, "groups_count": G}.
        """
        self.crops_dir.mkdir(parents=True, exist_ok=True)

        # Scope: top-level images with NO name and NO metadata date. Videos never use faces.
        candidates: list[Path] = []
        for p in sorted(source_dir.iterdir(), key=lambda x: x.name.lower()):
            if not p.is_file():
                continue
            if p.suffix.lower() not in IMAGE_EXTENSIONS:
                continue
            if not is_image_or_video(p.name):
                continue
            if extract_name(p.name) is not None:
                continue
            if capture_date(p) is not None:
                continue
            candidates.append(p)

        total_images = len(candidates)
        total_faces_found = 0
        images_scanned = 0

        for img_path in candidates:
            resolved_key = str(img_path.resolve())
            try:
                curr_size = img_path.stat().st_size
            except OSError:
                curr_size = 0

            # Check cache by path, size, and sha256
            cached_entry = self.cache.get(resolved_key)
            if cached_entry and cached_entry.get("size") == curr_size:
                curr_sha = compute_file_sha256(img_path)
                if cached_entry.get("sha256") == curr_sha:
                    # File unchanged, reuse cached faces
                    face_records = cached_entry.get("faces", [])
                else:
                    face_records = self._process_image(img_path, curr_size, curr_sha)
            else:
                curr_sha = compute_file_sha256(img_path)
                face_records = self._process_image(img_path, curr_size, curr_sha)

            total_faces_found += len(face_records)

            # Assign each face to a group
            assigned_group_ids: list[str] = []
            for face_rec in face_records:
                emb = np.array(face_rec["embedding"], dtype=np.float32)
                group = self._find_matching_group(emb, threshold)
                if group is None:
                    # Create a new group
                    group_id = f"group_{len(self.groups) + 1:03d}"
                    crop_filename = f"crop_{group_id}.jpg"
                    crop_path = self.crops_dir / crop_filename

                    # Save crop if available
                    raw_crop = face_rec.get("crop")
                    if raw_crop is not None:
                        try:
                            cv2.imwrite(str(crop_path), raw_crop)
                        except Exception:
                            pass

                    group = {
                        "id": group_id,
                        "name": None,
                        "crop_path": str(crop_path) if crop_path.exists() else "",
                        "representative_embedding": face_rec["embedding"],
                    }
                    self.groups.append(group)

                assigned_group_ids.append(group["id"])

            self.file_groups[resolved_key] = assigned_group_ids
            images_scanned += 1
            if progress_callback:
                progress_callback(images_scanned, total_images, total_faces_found)

        self.save()
        return {
            "images_scanned": images_scanned,
            "faces_found": total_faces_found,
            "groups_count": len(self.groups),
        }

    def _process_image(self, img_path: Path, size: int, sha256: str) -> list[dict]:
        """Detect faces and compute embeddings for an image, updating cache."""
        faces = detect_faces(img_path)
        face_records = []

        for face in faces:
            emb = embed_face(img_path, face)
            if emb is None:
                continue
            crop = align_and_crop(img_path, face)

            # Extract box as list of ints [x, y, w, h]
            box = [int(v) for v in face[0:4]]
            score = float(face[14]) if len(face) > 14 else 1.0

            face_records.append({
                "box": box,
                "score": score,
                "embedding": [float(x) for x in emb],
                "crop": crop,
            })

        # Cache without the raw numpy crop to keep json clean
        serializable_faces = [
            {
                "box": r["box"],
                "score": r["score"],
                "embedding": r["embedding"],
            }
            for r in face_records
        ]
        self.cache[str(img_path.resolve())] = {
            "size": size,
            "sha256": sha256,
            "faces": serializable_faces,
        }
        return face_records

    def name_group(self, group_id: str, name: str) -> None:
        """Name a group. One name can cover multiple groups; saving the same name merges them."""
        clean_name = name.strip().lower() if name else None
        if not clean_name:
            clean_name = None

        target_group = None
        for g in self.groups:
            if g["id"] == group_id:
                target_group = g
                break

        if target_group is None:
            return

        target_group["name"] = clean_name

        # If name is given and matches existing group(s), both groups retain that name
        # so any face from either group belongs to clean_name
        self.save()

    def get_group_name(self, group_id: str) -> str | None:
        """Get the assigned person name for a group ID."""
        for g in self.groups:
            if g["id"] == group_id:
                return g.get("name")
        return None

    def build_face_map(self) -> dict[str, str | None]:
        """Build map of {file_path_resolved: person_name_or_None}.
        
        Rules:
        - Faces from one named person only: person_name
        - Faces from two or more different named people: None (Unsorted)
        - Faces only from unnamed groups: None (Unsorted)
        - No faces: None (Unsorted)
        """
        face_map: dict[str, str | None] = {}

        for file_key, group_ids in self.file_groups.items():
            if not group_ids:
                face_map[file_key] = None
                continue

            named_people = set()
            has_unnamed = False

            for gid in group_ids:
                pname = self.get_group_name(gid)
                if pname:
                    named_people.add(pname)
                else:
                    has_unnamed = True

            # Faces from one named person only
            if len(named_people) == 1 and not has_unnamed:
                face_map[file_key] = list(named_people)[0]
            else:
                face_map[file_key] = None

        return face_map
