"""Face clustering, caching, video frame sampling, and group management for Nexora."""

from __future__ import annotations

import hashlib
import json
import os
import sys
import threading
from pathlib import Path
from typing import Callable, Any
import cv2
import numpy as np

from nexora.names import is_image_or_video, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS
from nexora.faces.detect import detect_faces
from nexora.faces.recognize import (
    DEFAULT_THRESHOLD,
    align_and_crop,
    cosine_similarity,
    embed_face,
)


def get_runs_dir() -> Path:
    """Get the runs directory path next to app.py or executable."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent / "runs"
    return Path(__file__).resolve().parent.parent.parent / "runs"


def compute_file_sha256(path: Path) -> str:
    """Compute SHA-256 of a file using 1 MB chunks."""
    hasher = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(1024 * 1024):
            hasher.update(chunk)
    return hasher.hexdigest()


class FaceClusterManager:
    """Manages face cache, clustering into groups, group naming, video sampling, and face mapping."""

    def __init__(self, json_path: Path | None = None) -> None:
        self.json_path = json_path or (get_runs_dir() / "faces.json")
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

    def _sample_video_frames(self, video_path: Path, num_frames: int = 5) -> list[np.ndarray] | None:
        """Sample num_frames spaced evenly through a video. Returns list of BGR frames or None."""
        try:
            cap = cv2.VideoCapture(str(video_path))
            if not cap.isOpened():
                return None
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            if total_frames <= 0:
                cap.release()
                return None

            indices = [
                min(int((i + 0.5) * total_frames / num_frames), total_frames - 1)
                for i in range(num_frames)
            ]
            frames: list[np.ndarray] = []
            for idx in indices:
                cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
                ret, frame = cap.read()
                if ret and frame is not None:
                    frames.append(frame)
            cap.release()
            return frames if len(frames) > 0 else None
        except Exception:
            return None

    def scan_source(
        self,
        source_dir: Path,
        threshold: float = DEFAULT_THRESHOLD,
        progress_callback: Callable[[int, int, int], None] | None = None,
        stop_event: threading.Event | None = None,
    ) -> dict[str, int]:
        """Scan source folder for all images and videos and cluster faces.
        
        Args:
            source_dir: Folder to scan (top-level only).
            threshold: Cosine similarity threshold for clustering.
            progress_callback: Optional callable(scanned_items, total_items, total_faces).
            stop_event: Optional threading.Event to request graceful stop.
            
        Returns:
            Dict summary with {"images_scanned": N, "faces_found": M, "groups_count": G}.
        """
        self.crops_dir.mkdir(parents=True, exist_ok=True)

        # Candidates: every top-level image and video in source_dir
        candidates: list[Path] = []
        for p in sorted(source_dir.iterdir(), key=lambda x: x.name.lower()):
            if not p.is_file():
                continue
            if not is_image_or_video(p.name):
                continue
            candidates.append(p)

        total_items = len(candidates)
        total_faces_found = 0
        items_scanned = 0

        for item_path in candidates:
            if stop_event and stop_event.is_set():
                break

            resolved_key = str(item_path.resolve())
            try:
                curr_size = item_path.stat().st_size
            except OSError:
                curr_size = 0

            ext = item_path.suffix.lower()
            is_video = ext in VIDEO_EXTENSIONS

            # Check cache by path, size, and sha256
            cached_entry = self.cache.get(resolved_key)
            unchanged = False
            curr_sha = None

            if cached_entry and cached_entry.get("size") == curr_size:
                curr_sha = compute_file_sha256(item_path)
                if cached_entry.get("sha256") == curr_sha:
                    unchanged = True

            if unchanged:
                # Reuse cached data
                if is_video:
                    # Video cached faces
                    cached_records = cached_entry.get("faces", [])
                    total_faces_found += len(cached_records)
                else:
                    face_records = cached_entry.get("faces", [])
                    total_faces_found += len(face_records)
            else:
                if curr_sha is None:
                    curr_sha = compute_file_sha256(item_path)

                if is_video:
                    total_faces_found += self._process_video(item_path, curr_size, curr_sha, threshold)
                else:
                    face_records = self._process_image(item_path, curr_size, curr_sha)
                    total_faces_found += len(face_records)

                    # Assign each face in image to a group
                    assigned_group_ids: list[str] = []
                    for face_rec in face_records:
                        emb = np.array(face_rec["embedding"], dtype=np.float32)
                        group = self._find_matching_group(emb, threshold)
                        if group is None:
                            group = self._create_group(face_rec)
                        else:
                            self._append_crop(group, face_rec.get("crop"))
                        assigned_group_ids.append(group["id"])

                    self.file_groups[resolved_key] = assigned_group_ids

            items_scanned += 1
            if progress_callback:
                progress_callback(items_scanned, total_items, total_faces_found)

        self.save()
        return {
            "images_scanned": items_scanned,
            "faces_found": total_faces_found,
            "groups_count": len(self.groups),
        }

    def _create_group(self, face_rec: dict) -> dict:
        """Create a new face group and save initial crop."""
        group_id = f"group_{len(self.groups) + 1:03d}"
        crop_filename = f"crop_{group_id}_0.jpg"
        crop_path = self.crops_dir / crop_filename

        raw_crop = face_rec.get("crop")
        crops_saved: list[str] = []
        if raw_crop is not None:
            try:
                cv2.imwrite(str(crop_path), raw_crop)
                crops_saved.append(str(crop_path))
            except Exception:
                pass

        group = {
            "id": group_id,
            "name": None,
            "display_name": None,
            "crop_path": str(crop_path) if crop_path.exists() else "",
            "crop_paths": crops_saved,
            "representative_embedding": face_rec["embedding"],
        }
        self.groups.append(group)
        return group

    def _append_crop(self, group: dict, crop: np.ndarray | None) -> None:
        """Save additional sample crops up to 6 per group."""
        if crop is None:
            return
        crops_list = group.setdefault("crop_paths", [])
        if len(crops_list) < 6:
            crop_filename = f"crop_{group['id']}_{len(crops_list)}.jpg"
            crop_path = self.crops_dir / crop_filename
            try:
                cv2.imwrite(str(crop_path), crop)
                crops_list.append(str(crop_path))
                if not group.get("crop_path"):
                    group["crop_path"] = str(crop_path)
            except Exception:
                pass

    def _process_image(self, img_path: Path, size: int, sha256: str) -> list[dict]:
        """Detect faces and compute embeddings for an image, updating cache."""
        faces = detect_faces(img_path)
        face_records = []

        for face in faces:
            emb = embed_face(img_path, face)
            if emb is None:
                continue
            crop = align_and_crop(img_path, face)

            box = [int(v) for v in face[0:4]]
            score = float(face[14]) if len(face) > 14 else 1.0

            face_records.append({
                "box": box,
                "score": score,
                "embedding": [float(x) for x in emb],
                "crop": crop,
            })

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
            "type": "image",
            "faces": serializable_faces,
        }
        return face_records

    def _process_video(self, video_path: Path, size: int, sha256: str, threshold: float) -> int:
        """Sample 5 frames from video, detect faces, match to groups, and update cache.
        
        A face counts for a video only if it appears in at least 2 of the 5 sampled frames.
        If a video cannot be read, mark it 'could not read' and continue.
        """
        resolved_key = str(video_path.resolve())
        frames = self._sample_video_frames(video_path, num_frames=5)

        if frames is None:
            self.cache[resolved_key] = {
                "size": size,
                "sha256": sha256,
                "type": "video",
                "status": "could not read",
                "faces": [],
            }
            self.file_groups[resolved_key] = []
            return 0

        # For each sampled frame, detect faces
        # Track group occurrences across frames: {group_id: set_of_frame_indices}
        group_frame_occurrences: dict[str, set[int]] = {}
        all_video_faces: list[dict] = []

        for frame_idx, frame in enumerate(frames):
            detected = detect_faces(frame)
            for face in detected:
                emb = embed_face(frame, face)
                if emb is None:
                    continue
                crop = align_and_crop(frame, face)
                box = [int(v) for v in face[0:4]]
                score = float(face[14]) if len(face) > 14 else 1.0

                face_rec = {
                    "box": box,
                    "score": score,
                    "embedding": [float(x) for x in emb],
                    "crop": crop,
                }
                all_video_faces.append(face_rec)

                group = self._find_matching_group(np.array(emb, dtype=np.float32), threshold)
                if group is None:
                    group = self._create_group(face_rec)
                else:
                    self._append_crop(group, crop)

                gid = group["id"]
                group_frame_occurrences.setdefault(gid, set()).add(frame_idx)

        # A face counts for a video only if it appears in at least 2 of the 5 sampled frames
        qualifying_group_ids = [
            gid for gid, frame_set in group_frame_occurrences.items()
            if len(frame_set) >= 2
        ]

        serializable_faces = [
            {
                "box": r["box"],
                "score": r["score"],
                "embedding": r["embedding"],
            }
            for r in all_video_faces
        ]
        self.cache[resolved_key] = {
            "size": size,
            "sha256": sha256,
            "type": "video",
            "status": "ok",
            "faces": serializable_faces,
        }
        self.file_groups[resolved_key] = qualifying_group_ids
        return len(all_video_faces)

    def name_group(self, group_id: str, name: str) -> None:
        """Name a group. One name can cover multiple groups; saving same name merges them."""
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
        target_group["display_name"] = name.strip() if name else None
        self.save()

    def get_group_name(self, group_id: str) -> str | None:
        """Get the assigned person name for a group ID."""
        for g in self.groups:
            if g["id"] == group_id:
                return g.get("name")
        return None

    def build_face_map(self) -> dict[str, str | None]:
        """Build map of {file_path_resolved: person_name_or_None} (Stage 3 compatibility)."""
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

            if len(named_people) == 1 and not has_unnamed:
                face_map[file_key] = list(named_people)[0]
            else:
                face_map[file_key] = None
        return face_map
