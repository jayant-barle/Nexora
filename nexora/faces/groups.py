"""Face clustering, caching, video frame sampling, and group management for Nexora."""

from __future__ import annotations

import hashlib
import json
import os
import sys
import threading
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
from typing import Callable, Any
import cv2
import numpy as np

from nexora.names import is_image_or_video, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS
from nexora.faces.detect import (
    SCORE_THRESHOLD,
    MIN_FACE_SIZE,
    MAX_ASPECT_RATIO,
    TARGET_SIZE,
    detect_faces,
    get_default_yunet_path,
    get_detector,
    read_image_bgr,
)
from nexora.faces.recognize import (
    DEFAULT_THRESHOLD,
    DEFAULT_SFACE_PATH,
    align_and_crop,
    cosine_similarity,
    embed_face,
    get_recognizer,
)

# Named constants for drift mitigation and giant cluster safeguard
MAX_REPRESENTATIVE_MEMBERS = 5  # M: freeze comparison representative after first M members to stop centroid drift
REPRESENTATIVE_M = MAX_REPRESENTATIVE_MEMBERS
CLUSTER_CAP_RATIO = 0.05        # Flag cluster as "needs review" if it exceeds 5% of scanned faces
CLUSTER_CAP_MAX = 200           # Flag cluster as "needs review" if it exceeds 200 faces
CLUSTER_CAP_FLOOR = 20          # Floor threshold so small test clusters are not falsely flagged


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


_worker_detector = None
_worker_recognizer = None


def _worker_init(yunet_path_str: str | None, sface_path_str: str | None, score_threshold: float) -> None:
    """Initialize detector and recognizer models once per worker process."""
    global _worker_detector, _worker_recognizer
    y_path = Path(yunet_path_str) if yunet_path_str else None
    s_path = Path(sface_path_str) if sface_path_str else None
    _worker_detector = get_detector(y_path, score_threshold=score_threshold)
    _worker_recognizer = get_recognizer(s_path)


def _worker_process_file(task_args: tuple) -> dict[str, Any]:
    """Worker task that processes a single image or video at 1280px resolution.
    
    Computes face embeddings only for faces that pass the quality filter.
    """
    file_path_str, is_video, curr_size, curr_sha, yunet_path_str, sface_path_str = task_args
    file_path = Path(file_path_str)
    y_path = Path(yunet_path_str) if yunet_path_str else None
    s_path = Path(sface_path_str) if sface_path_str else None

    if is_video:
        try:
            cap = cv2.VideoCapture(str(file_path))
            if not cap.isOpened():
                return {
                    "resolved_key": file_path_str,
                    "type": "video",
                    "size": curr_size,
                    "sha256": curr_sha,
                    "status": "could not read",
                    "frame_faces": [],
                }
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            if total_frames <= 0:
                cap.release()
                return {
                    "resolved_key": file_path_str,
                    "type": "video",
                    "size": curr_size,
                    "sha256": curr_sha,
                    "status": "could not read",
                    "frame_faces": [],
                }

            indices = [
                min(int((i + 0.5) * total_frames / 5), total_frames - 1)
                for i in range(5)
            ]
            frames: list[np.ndarray] = []
            for idx in indices:
                cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
                ret, frame = cap.read()
                if ret and frame is not None:
                    # Normalize frame to 1280px
                    fh, fw = frame.shape[:2]
                    longest = max(fh, fw)
                    if longest != TARGET_SIZE and longest > 0:
                        scale = TARGET_SIZE / float(longest)
                        frame_1280 = cv2.resize(frame, (int(round(fw * scale)), int(round(fh * scale))))
                    else:
                        frame_1280 = frame
                    frames.append(frame_1280)
            cap.release()

            if len(frames) == 0:
                return {
                    "resolved_key": file_path_str,
                    "type": "video",
                    "size": curr_size,
                    "sha256": curr_sha,
                    "status": "could not read",
                    "frame_faces": [],
                }

            frame_faces = []
            for frame in frames:
                detected = detect_faces(frame, model_path=y_path, score_threshold=SCORE_THRESHOLD)
                faces_in_frame = []
                for face in detected:
                    emb = embed_face(frame, face, model_path=s_path)
                    if emb is None:
                        continue
                    crop = align_and_crop(frame, face, model_path=s_path)
                    crop_bytes = None
                    if crop is not None:
                        try:
                            _, buf = cv2.imencode(".jpg", crop)
                            crop_bytes = buf.tobytes()
                        except Exception:
                            pass

                    box = [int(v) for v in face[0:4]]
                    score = float(face[14]) if len(face) > 14 else 1.0
                    faces_in_frame.append({
                        "box": box,
                        "score": score,
                        "embedding": [float(x) for x in emb],
                        "crop_bytes": crop_bytes,
                    })
                frame_faces.append(faces_in_frame)

            return {
                "resolved_key": file_path_str,
                "type": "video",
                "size": curr_size,
                "sha256": curr_sha,
                "status": "ok",
                "frame_faces": frame_faces,
            }
        except Exception:
            return {
                "resolved_key": file_path_str,
                "type": "video",
                "size": curr_size,
                "sha256": curr_sha,
                "status": "could not read",
                "frame_faces": [],
            }
    else:
        # Image
        try:
            detected = detect_faces(file_path, model_path=y_path, score_threshold=SCORE_THRESHOLD)
            img_bgr = None
            face_records = []

            for face in detected:
                if img_bgr is None:
                    img_bgr = read_image_bgr(file_path, apply_exif_transpose=True)
                if img_bgr is None:
                    continue

                emb = embed_face(img_bgr, face, model_path=s_path)
                if emb is None:
                    continue
                crop = align_and_crop(img_bgr, face, model_path=s_path)
                crop_bytes = None
                if crop is not None:
                    try:
                        _, buf = cv2.imencode(".jpg", crop)
                        crop_bytes = buf.tobytes()
                    except Exception:
                        pass

                box = [int(v) for v in face[0:4]]
                score = float(face[14]) if len(face) > 14 else 1.0
                face_records.append({
                    "box": box,
                    "score": score,
                    "embedding": [float(x) for x in emb],
                    "crop_bytes": crop_bytes,
                })

            return {
                "resolved_key": file_path_str,
                "type": "image",
                "size": curr_size,
                "sha256": curr_sha,
                "status": "ok",
                "faces": face_records,
            }
        except Exception:
            return {
                "resolved_key": file_path_str,
                "type": "image",
                "size": curr_size,
                "sha256": curr_sha,
                "status": "could not read",
                "faces": [],
            }


class FaceClusterManager:
    """Manages face cache, clustering into groups, group naming, video sampling, and face mapping."""

    def __init__(self, json_path: Path | None = None) -> None:
        self.json_path = json_path or (get_runs_dir() / "faces.json")
        self.crops_dir = self.json_path.parent / "face_crops"
        self.cache: dict[str, dict] = {}
        self.groups: list[dict] = []
        self.file_groups: dict[str, list[str]] = {}
        self.face_names: dict[str, str] = {}
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
            self.face_names = data.get("face_names", {})
        except Exception:
            self.cache = {}
            self.groups = []
            self.file_groups = {}
            self.face_names = {}

    def save(self) -> None:
        """Save state to JSON atomically using a temp file and replace."""
        self.json_path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = self.json_path.with_suffix(".tmp")
        data = {
            "version": 1,
            "cache": self.cache,
            "groups": self.groups,
            "file_groups": self.file_groups,
            "face_names": self.face_names,
        }
        with open(temp_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp_path, self.json_path)

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

    def cluster_all_faces(self, threshold: float = DEFAULT_THRESHOLD) -> None:
        """Cluster all faces across self.cache in fixed canonical order.
        
        Incremental centroid clustering on cosine similarity (threshold 0.363 by default).
        Processes faces in deterministic order sorted by (file_key, face_idx).
        For each face, compares its normalised embedding with current cluster centroids
        via a single numpy matrix-vector product. Joins the best cluster if similarity >= threshold,
        updating its centroid incrementally, or starts a new cluster.
        Deterministic, shuffle-invariant, and idempotent on re-run.
        """
        # Collect all accepted faces
        face_items: list[dict[str, Any]] = []

        for file_key in sorted(self.cache.keys()):
            entry = self.cache[file_key]
            faces = entry.get("faces", [])
            for face_idx, f_rec in enumerate(faces):
                raw_emb = f_rec.get("embedding")
                if not raw_emb:
                    continue
                arr = np.array(raw_emb, dtype=np.float32)
                norm = float(np.linalg.norm(arr))
                if norm == 0.0:
                    continue
                norm_emb = arr / norm
                face_items.append({
                    "file_key": file_key,
                    "face_idx": face_idx,
                    "norm_emb": norm_emb,
                    "crop_path": f_rec.get("crop_path"),
                    "frame_idx": f_rec.get("frame_idx", 0),
                })

        if not face_items:
            self.groups = []
            self.file_groups = {fk: [] for fk in self.cache}
            return

        # Canonical sort by (file_key, face_idx) to guarantee complete shuffle-invariance
        face_items.sort(key=lambda x: (x["file_key"], x["face_idx"]))

        n_faces = len(face_items)
        cluster_cap = min(max(CLUSTER_CAP_FLOOR, int(n_faces * CLUSTER_CAP_RATIO)), CLUSTER_CAP_MAX)

        # Preallocate centroids buffer for up to n_faces clusters (shape (n_faces, 128))
        centroids_buffer = np.zeros((n_faces, 128), dtype=np.float32)
        n_clusters = 0

        clusters: list[dict[str, Any]] = []

        for item in face_items:
            emb = item["norm_emb"]
            fk = item["file_key"]
            idx = item["face_idx"]
            crop_p = item.get("crop_path")

            if n_clusters == 0:
                # First face creates first cluster
                centroids_buffer[0] = emb
                n_clusters = 1
                clusters.append({
                    "canonical_key": (fk, idx),
                    "members": [(fk, idx)],
                    "representative_members": [emb],
                    "count": 1,
                    "centroid": emb.copy(),
                    "crop_paths": [crop_p] if crop_p else [],
                })
            else:
                # Compare against all current cluster centroids via matrix-vector product
                sims = centroids_buffer[:n_clusters] @ emb
                best_idx = int(np.argmax(sims))
                best_sim = float(sims[best_idx])

                if best_sim >= threshold:
                    # Join best cluster; update representative centroid only for first M members to stop drift
                    c = clusters[best_idx]
                    c["members"].append((fk, idx))
                    c["count"] += 1
                    if len(c["representative_members"]) < MAX_REPRESENTATIVE_MEMBERS:
                        c["representative_members"].append(emb)
                        mean_emb = np.mean(c["representative_members"], axis=0)
                        norm_val = float(np.linalg.norm(mean_emb))
                        new_centroid = (mean_emb / norm_val) if norm_val > 0 else mean_emb
                        c["centroid"] = new_centroid
                        centroids_buffer[best_idx] = new_centroid
                    if crop_p and crop_p not in c["crop_paths"] and len(c["crop_paths"]) < 6:
                        c["crop_paths"].append(crop_p)
                else:
                    # Start a new cluster
                    centroids_buffer[n_clusters] = emb
                    clusters.append({
                        "canonical_key": (fk, idx),
                        "members": [(fk, idx)],
                        "representative_members": [emb],
                        "count": 1,
                        "centroid": emb.copy(),
                        "crop_paths": [crop_p] if crop_p else [],
                    })
                    n_clusters += 1

        # Sort clusters deterministically: size descending, tie-break by canonical key
        clusters.sort(key=lambda c: (-c["count"], c["canonical_key"]))

        face_to_group_id: dict[tuple[str, int], str] = {}
        new_groups: list[dict[str, Any]] = []

        import collections
        for rank, c in enumerate(clusters, start=1):
            gid = f"group_{rank:03d}"
            for m in c["members"]:
                face_to_group_id[m] = gid

            # Check if any member has an assigned name in self.face_names
            member_names = [
                self.face_names[f"{m_fk}:{m_idx}"]
                for m_fk, m_idx in c["members"]
                if f"{m_fk}:{m_idx}" in self.face_names
            ]
            assigned_display = None
            assigned_folder = None
            if member_names:
                assigned_display = collections.Counter(member_names).most_common(1)[0][0]
                assigned_folder = assigned_display.strip().lower()
                for m_fk, m_idx in c["members"]:
                    self.face_names[f"{m_fk}:{m_idx}"] = assigned_display

            group_dict = {
                "id": gid,
                "name": assigned_folder,
                "display_name": assigned_display,
                "crop_path": c["crop_paths"][0] if c["crop_paths"] else "",
                "crop_paths": c["crop_paths"],
                "representative_embedding": [float(x) for x in c["centroid"]],
                "member_faces": [f"{m_fk}:{m_idx}" for m_fk, m_idx in c["members"]],
                "needs_review": (c["count"] > cluster_cap) and not assigned_display,
            }
            new_groups.append(group_dict)

        self.groups = new_groups

        # Update file_groups
        self.file_groups = {}
        for file_key in sorted(self.cache.keys()):
            entry = self.cache[file_key]
            item_type = entry.get("type")
            faces = entry.get("faces", [])

            if item_type == "video":
                frame_occurrences: dict[str, set[int]] = {}
                for idx, f in enumerate(faces):
                    gid = face_to_group_id.get((file_key, idx))
                    if gid:
                        f_idx = f.get("frame_idx", 0)
                        frame_occurrences.setdefault(gid, set()).add(f_idx)
                qualifying_gids = [
                    gid for gid, fset in sorted(frame_occurrences.items())
                    if len(fset) >= 2
                ]
                self.file_groups[file_key] = qualifying_gids
            else:
                assigned_gids = []
                for idx in range(len(faces)):
                    gid = face_to_group_id.get((file_key, idx))
                    if gid:
                        assigned_gids.append(gid)
                self.file_groups[file_key] = assigned_gids

    def scan_source(
        self,
        source_dir: Path,
        threshold: float = DEFAULT_THRESHOLD,
        progress_callback: Callable[[int, int, int], None] | None = None,
        stop_event: threading.Event | None = None,
        max_workers: int | None = None,
    ) -> dict[str, int]:
        """Scan source folder for all images and videos and cluster faces.
        
        Saves runs/faces.json atomically after every 50 images and upon stop/finish.
        Uses ProcessPoolExecutor with (CPU count - 1) workers for fast parallel scanning.
        """
        self.crops_dir.mkdir(parents=True, exist_ok=True)

        candidates: list[Path] = []
        for p in sorted(source_dir.iterdir(), key=lambda x: x.name.lower()):
            if not p.is_file():
                continue
            if not is_image_or_video(p.name):
                continue
            candidates.append(p)

        total_items = len(candidates)
        total_faces_found = 0
        scanned_count = 0

        # Separate candidates into cached (unchanged) and uncached
        cached_tasks: list[tuple[Path, int, str, bool]] = []
        uncached_tasks: list[tuple[Path, int, str, bool]] = []

        for p in candidates:
            resolved_key = str(p.resolve())
            try:
                curr_size = p.stat().st_size
            except OSError:
                curr_size = 0
            is_video = p.suffix.lower() in VIDEO_EXTENSIONS

            cached_entry = self.cache.get(resolved_key)
            if cached_entry and cached_entry.get("size") == curr_size:
                curr_sha = compute_file_sha256(p)
                if cached_entry.get("sha256") == curr_sha:
                    cached_tasks.append((p, curr_size, curr_sha, is_video))
                    continue
            else:
                curr_sha = compute_file_sha256(p)
            uncached_tasks.append((p, curr_size, curr_sha, is_video))

        # First, process cached hits quickly
        for p, curr_size, curr_sha, is_video in cached_tasks:
            if stop_event and stop_event.is_set():
                break

            resolved_key = str(p.resolve())
            cached_entry = self.cache[resolved_key]
            if is_video:
                total_faces_found += len(cached_entry.get("faces", []))
            else:
                total_faces_found += len(cached_entry.get("faces", []))

            scanned_count += 1
            if scanned_count % 50 == 0:
                self.save()
                if progress_callback:
                    progress_callback(scanned_count, total_items, total_faces_found)

        # Second, process uncached items
        is_mocked = hasattr(self._process_image, "mock_calls")
        yunet_path_str = str(get_default_yunet_path())
        sface_path_str = str(DEFAULT_SFACE_PATH)

        workers = max_workers or max(1, (os.cpu_count() or 2) - 1)

        # If mocked or single worker or few items, run directly
        if is_mocked or workers <= 1 or len(uncached_tasks) <= 1:
            for item_path, curr_size, curr_sha, is_video in uncached_tasks:
                if stop_event and stop_event.is_set():
                    break

                resolved_key = str(item_path.resolve())
                if is_video:
                    total_faces_found += self._process_video(item_path, curr_size, curr_sha, threshold)
                else:
                    face_records = self._process_image(item_path, curr_size, curr_sha)
                    total_faces_found += len(face_records)

                    assigned_group_ids: list[str] = []
                    for face_rec in face_records:
                        emb = np.array(face_rec["embedding"], dtype=np.float32)
                        group = self._find_matching_group(emb, threshold)
                        if group is None:
                            group = self._create_group(face_rec)
                        else:
                            self._append_crop(group, face_rec.get("crop"))
                        assigned_group_ids.append(group["id"])

                    serializable_faces = [
                        {"box": r["box"], "score": r["score"], "embedding": r["embedding"]}
                        for r in face_records
                    ]
                    self.cache[resolved_key] = {
                        "size": curr_size,
                        "sha256": curr_sha,
                        "type": "image",
                        "status": "ok",
                        "faces": serializable_faces,
                    }
                    self.file_groups[resolved_key] = assigned_group_ids

                scanned_count += 1
                if scanned_count % 50 == 0:
                    self.save()
                    if progress_callback:
                        progress_callback(scanned_count, total_items, total_faces_found)
        else:
            # Parallel execution with ProcessPoolExecutor in chunks of 50
            batch_size = 50
            task_args_list = [
                (str(p.resolve()), is_vid, sz, sha, yunet_path_str, sface_path_str)
                for p, sz, sha, is_vid in uncached_tasks
            ]

            with ProcessPoolExecutor(
                max_workers=workers,
                initializer=_worker_init,
                initargs=(yunet_path_str, sface_path_str, SCORE_THRESHOLD),
            ) as executor:
                for i in range(0, len(task_args_list), batch_size):
                    if stop_event and stop_event.is_set():
                        break

                    chunk_tasks = task_args_list[i : i + batch_size]
                    futures = [executor.submit(_worker_process_file, t) for t in chunk_tasks]

                    for fut in as_completed(futures):
                        if stop_event and stop_event.is_set():
                            break

                        result = fut.result()
                        resolved_key = result["resolved_key"]
                        item_type = result["type"]
                        curr_size = result["size"]
                        curr_sha = result["sha256"]

                        if item_type == "video":
                            if result["status"] == "could not read":
                                self.cache[resolved_key] = {
                                    "size": curr_size,
                                    "sha256": curr_sha,
                                    "type": "video",
                                    "status": "could not read",
                                    "faces": [],
                                }
                                self.file_groups[resolved_key] = []
                            else:
                                frame_faces = result.get("frame_faces", [])
                                group_frame_occurrences: dict[str, set[int]] = {}
                                all_video_faces: list[dict] = []

                                for frame_idx, faces_in_frame in enumerate(frame_faces):
                                    for face_rec in faces_in_frame:
                                        emb = np.array(face_rec["embedding"], dtype=np.float32)
                                        all_video_faces.append(face_rec)
                                        group = self._find_matching_group(emb, threshold)
                                        if group is None:
                                            group = self._create_group_from_bytes(face_rec)
                                        else:
                                            self._append_crop_bytes(group, face_rec.get("crop_bytes"))
                                        group_frame_occurrences.setdefault(group["id"], set()).add(frame_idx)

                                qualifying_gids = [
                                    gid for gid, f_set in group_frame_occurrences.items()
                                    if len(f_set) >= 2
                                ]
                                serializable_faces = [
                                    {"box": r["box"], "score": r["score"], "embedding": r["embedding"]}
                                    for r in all_video_faces
                                ]
                                self.cache[resolved_key] = {
                                    "size": curr_size,
                                    "sha256": curr_sha,
                                    "type": "video",
                                    "status": "ok",
                                    "faces": serializable_faces,
                                }
                                self.file_groups[resolved_key] = qualifying_gids
                                total_faces_found += len(all_video_faces)
                        else:
                            # Image
                            face_records = result.get("faces", [])
                            total_faces_found += len(face_records)

                            assigned_group_ids = []
                            for face_rec in face_records:
                                emb = np.array(face_rec["embedding"], dtype=np.float32)
                                group = self._find_matching_group(emb, threshold)
                                if group is None:
                                    group = self._create_group_from_bytes(face_rec)
                                else:
                                    self._append_crop_bytes(group, face_rec.get("crop_bytes"))
                                assigned_group_ids.append(group["id"])

                            serializable_faces = [
                                {"box": r["box"], "score": r["score"], "embedding": r["embedding"]}
                                for r in face_records
                            ]
                            self.cache[resolved_key] = {
                                "size": curr_size,
                                "sha256": curr_sha,
                                "type": "image",
                                "status": "ok",
                                "faces": serializable_faces,
                            }
                            self.file_groups[resolved_key] = assigned_group_ids

                        scanned_count += 1
                        if scanned_count % 50 == 0:
                            self.save()
                            if progress_callback:
                                progress_callback(scanned_count, total_items, total_faces_found)

        # Cluster all faces in one pass
        self.cluster_all_faces(threshold=threshold)
        # Final save upon finish or stop
        self.save()
        if progress_callback:
            progress_callback(scanned_count, total_items, total_faces_found)

        return {
            "images_scanned": scanned_count,
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

    def _create_group_from_bytes(self, face_rec: dict) -> dict:
        """Create a new face group from encoded crop bytes."""
        group_id = f"group_{len(self.groups) + 1:03d}"
        crop_filename = f"crop_{group_id}_0.jpg"
        crop_path = self.crops_dir / crop_filename

        crop_bytes = face_rec.get("crop_bytes")
        crops_saved: list[str] = []
        if crop_bytes:
            try:
                with open(crop_path, "wb") as f:
                    f.write(crop_bytes)
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

    def _append_crop_bytes(self, group: dict, crop_bytes: bytes | None) -> None:
        """Save additional sample crops up to 6 per group from bytes."""
        if not crop_bytes:
            return
        crops_list = group.setdefault("crop_paths", [])
        if len(crops_list) < 6:
            crop_filename = f"crop_{group['id']}_{len(crops_list)}.jpg"
            crop_path = self.crops_dir / crop_filename
            try:
                with open(crop_path, "wb") as f:
                    f.write(crop_bytes)
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
                "crop_path": str(self.crops_dir / f"crop_{sha256[:10]}_{idx}.jpg") if r.get("crop") is not None else None,
            }
            for idx, r in enumerate(face_records)
        ]
        # Save crops to disk
        for idx, r in enumerate(face_records):
            if r.get("crop") is not None:
                c_path = self.crops_dir / f"crop_{sha256[:10]}_{idx}.jpg"
                try:
                    cv2.imwrite(str(c_path), r["crop"])
                except Exception:
                    pass

        self.cache[str(img_path.resolve())] = {
            "size": size,
            "sha256": sha256,
            "type": "image",
            "faces": serializable_faces,
        }
        return face_records

    def _process_video(self, video_path: Path, size: int, sha256: str, threshold: float) -> int:
        """Sample 5 frames from video, detect faces, match to groups, and update cache."""
        resolved_key = str(video_path.resolve())
        try:
            cap = cv2.VideoCapture(str(video_path))
            if not cap.isOpened():
                self.cache[resolved_key] = {
                    "size": size,
                    "sha256": sha256,
                    "type": "video",
                    "status": "could not read",
                    "faces": [],
                }
                self.file_groups[resolved_key] = []
                return 0

            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            if total_frames <= 0:
                cap.release()
                self.cache[resolved_key] = {
                    "size": size,
                    "sha256": sha256,
                    "type": "video",
                    "status": "could not read",
                    "faces": [],
                }
                self.file_groups[resolved_key] = []
                return 0

            indices = [
                min(int((i + 0.5) * total_frames / 5), total_frames - 1)
                for i in range(5)
            ]
            frames: list[np.ndarray] = []
            for idx in indices:
                cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
                ret, frame = cap.read()
                if ret and frame is not None:
                    # Normalize frame to 1280px
                    fh, fw = frame.shape[:2]
                    longest = max(fh, fw)
                    if longest != TARGET_SIZE and longest > 0:
                        scale = TARGET_SIZE / float(longest)
                        frame_1280 = cv2.resize(frame, (int(round(fw * scale)), int(round(fh * scale))))
                    else:
                        frame_1280 = frame
                    frames.append(frame_1280)
            cap.release()

            if len(frames) == 0:
                self.cache[resolved_key] = {
                    "size": size,
                    "sha256": sha256,
                    "type": "video",
                    "status": "could not read",
                    "faces": [],
                }
                self.file_groups[resolved_key] = []
                return 0

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
        except Exception:
            self.cache[resolved_key] = {
                "size": size,
                "sha256": sha256,
                "type": "video",
                "status": "could not read",
                "faces": [],
            }
            self.file_groups[resolved_key] = []
            return 0

    def name_group(self, group_id: str, name: str) -> None:
        """Name a group. One name can cover multiple groups; saving same name merges them."""
        clean_name = name.strip().lower() if name else None
        display_name = name.strip() if name else None
        if not clean_name:
            clean_name = None
            display_name = None

        target_group = None
        for g in self.groups:
            if g["id"] == group_id:
                target_group = g
                break

        if target_group is None:
            return

        target_group["name"] = clean_name
        target_group["display_name"] = display_name

        # Store name by member face in self.face_names so it survives re-clustering
        if not hasattr(self, "face_names"):
            self.face_names = {}

        for file_key, gids in self.file_groups.items():
            for idx, gid in enumerate(gids):
                if gid == group_id:
                    if display_name:
                        self.face_names[f"{file_key}:{idx}"] = display_name
                    elif f"{file_key}:{idx}" in self.face_names:
                        del self.face_names[f"{file_key}:{idx}"]

        if target_group.get("member_faces"):
            for m in target_group["member_faces"]:
                if display_name:
                    self.face_names[m] = display_name
                elif m in self.face_names:
                    del self.face_names[m]

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
