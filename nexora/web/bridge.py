"""Thread-safe Python-to-Web bridge API for Nexora's HTML5/JS/SVG interface.

All filesystem path validation, preview planning, SHA-256 verified file moves,
face clustering, people management, and undo orchestration remain exclusively in
Python. JavaScript never receives unrestricted filesystem access.
"""

from __future__ import annotations

import base64
import io
import json
import os
import secrets
import sys
import threading
import urllib.parse
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

from PIL import Image, ImageOps

try:
    from pillow_heif import register_heif_opener

    register_heif_opener()
except Exception:
    pass

from nexora.faces.groups import FaceClusterManager, get_runs_dir
from nexora.faces.people import PeopleManager
from nexora.metadata import capture_date
from nexora.mover import create_unique_run_folder, format_size as _format_size, run_plan
from nexora.names import IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, extract_name, is_image_or_video
from nexora.plan import PlannedMove, build_plan
from nexora.undo import find_latest_active_run_log, undo_run

SAFETY_FOOTER_TEXT = "Files are moved, not copied. Nothing is deleted."


def _read_app_version() -> str:
    """Read application version from VERSION file (dev or PyInstaller bundle)."""
    candidates: list[Path] = []
    if hasattr(sys, "_MEIPASS"):
        candidates.append(Path(sys._MEIPASS) / "VERSION")
    if getattr(sys, "frozen", False):
        candidates.append(Path(sys.executable).resolve().parent / "VERSION")
    candidates.append(Path(__file__).resolve().parent.parent.parent / "VERSION")

    for p in candidates:
        try:
            if p.is_file():
                return p.read_text(encoding="utf-8").strip()
        except OSError:
            continue
    return "0.5.5-dev"


class NexoraBridgeApi:
    """PyWebView JS API object exposing safe Nexora backend operations.

    Security notes:
    - All paths passed from JS are checked for null bytes, normalized, and
      validated against allowlisted directories before reading or rendering.
    - Move operations require explicit `confirmed=True` and strictly execute the
      Python-held `PlannedMove` list created by `build_plan()` — JS cannot alter
      destination paths or inject delete calls.
    - Background operations acquire `_job_lock` and prevent concurrent mutations.
    """

    def __init__(
        self,
        runs_dir: Path | None = None,
        folder_picker: Callable[[str], str | None] | None = None,
    ) -> None:
        self._runs_dir = Path(runs_dir).resolve() if runs_dir else get_runs_dir().resolve()
        self._runs_dir.mkdir(parents=True, exist_ok=True)
        self._crops_dir = (self._runs_dir / "face_crops").resolve()
        self._session_token = secrets.token_urlsafe(24)

        self._window: Any = None
        self._folder_picker = folder_picker

        self._state_lock = threading.RLock()
        self._source_dir: Path | None = None
        self._dest_dir: Path | None = None
        self._current_plan: list[PlannedMove] = []

        self._cluster_manager = FaceClusterManager(json_path=self._runs_dir / "faces.json")
        self._people_manager = PeopleManager(self._cluster_manager)
        self._last_corrupt_backup_name: str | None = (
            self._cluster_manager.corrupt_backup_path.name
            if self._cluster_manager.corrupt_backup_path
            else None
        )

        self._faces_lock = threading.RLock()
        self._last_faces_stat = self._read_faces_stat()
        self._job_lock = threading.Lock()
        self._scan_stop_event: threading.Event | None = None
        self._fresh_scan_in_session = False
        self._job_state: dict[str, Any] = {
            "kind": None,
            "running": False,
            "scanned": 0,
            "total": 0,
            "faces": 0,
            "percent": 0,
            "status_text": self._initial_status_text(),
            "error": None,
            "last_result": None,
        }

    def attach_window(self, window: Any) -> None:
        """Attach active PyWebView window reference for native OS dialogs."""
        self._window = window

    @property
    def session_token(self) -> str:
        """Per-session secret token authenticating local Bottle media/asset requests."""
        return self._session_token

    def _initial_status_text(self) -> str:
        """Compute initial status summary mirroring Tkinter NexoraApp startup."""
        if self._cluster_manager.corrupt_backup_path:
            return (
                f"Corrupt faces.json moved to "
                f"{self._cluster_manager.corrupt_backup_path.name}; starting clean."
            )
        if self._cluster_manager.json_path.exists():
            visible = self._people_manager.get_visible_groups()
            m_scanned = len(self._cluster_manager.cache)
            return f"Found {len(visible)} people from {m_scanned} scanned images"
        return "Ready"

    def _validate_clean_path_input(self, raw_path: str) -> Path:
        """Validate path string contains no null bytes and resolves cleanly."""
        if not isinstance(raw_path, str) or not raw_path.strip() or "\x00" in raw_path:
            raise ValueError("Invalid folder path.")
        return Path(raw_path.strip()).resolve()

    def _is_job_running(self) -> bool:
        with self._job_lock:
            return bool(self._job_state["running"])

    def _is_scan_running(self) -> bool:
        with self._job_lock:
            return bool(self._job_state["running"] and self._job_state["kind"] == "scan")

    def _read_faces_stat(self) -> tuple[int, int] | None:
        try:
            st = self._cluster_manager.json_path.stat()
            return (st.st_mtime_ns, st.st_size)
        except OSError:
            return None

    def _reload_faces_if_idle(self) -> None:
        # Skip reloading faces.json while scan_source holds unsaved checkpoints or file stat is unchanged
        if not self._is_scan_running():
            with self._faces_lock:
                curr_stat = self._read_faces_stat()
                if curr_stat is not None and curr_stat == self._last_faces_stat:
                    return
                self._cluster_manager.load()
                self._last_faces_stat = self._read_faces_stat()

    def _find_latest_active_run_log(self) -> Path | None:
        """Find newest non-empty run_<ts>/run.log that has not already been undone."""
        return find_latest_active_run_log(self._runs_dir)

    def media_url(self, file_path: str | Path | None) -> str | None:
        """Build an authenticated local HTTP media preview URL if path is allowlisted."""
        if not file_path:
            return None
        p = Path(str(file_path))
        if not self.is_allowed_media_path(p):
            return None
        encoded = urllib.parse.quote(str(p.resolve()), safe="")
        return f"/api/media?token={self._session_token}&path={encoded}"

    def is_allowed_media_path(self, candidate: str | Path) -> bool:
        """Allow media reads ONLY for face crops or top-level images in active source folder.

        Prevents JavaScript from using the media endpoint to probe arbitrary
        files elsewhere on disk.
        """
        try:
            raw = str(candidate)
            if not raw or "\x00" in raw:
                return False
            resolved = Path(raw).resolve()
            if not resolved.is_file():
                return False

            # 1. Face crop thumbnails saved under runs/face_crops/
            if resolved.is_relative_to(self._crops_dir) and resolved.suffix.lower() in IMAGE_EXTENSIONS:
                return True

            # 2. Top-level image files directly inside the user-selected source folder
            with self._state_lock:
                src = self._source_dir
            if src is not None:
                src_resolved = src.resolve()
                if resolved.parent == src_resolved and resolved.suffix.lower() in IMAGE_EXTENSIONS:
                    return True
            return False
        except Exception:
            return False

    def render_media_jpeg(self, path_str: str, max_size: int = 480) -> bytes:
        """Read an allowlisted image (including HEIC) and encode a bounded JPEG thumbnail."""
        if not self.is_allowed_media_path(path_str):
            raise PermissionError("Access denied: file is outside active media allowlist.")
        resolved = Path(path_str).resolve()
        with Image.open(resolved) as img:
            transposed = ImageOps.exif_transpose(img) or img
            rgb = transposed.convert("RGB")
            if max(rgb.size) > max_size:
                rgb.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
            buf = io.BytesIO()
            rgb.save(buf, format="JPEG", quality=85)
            return buf.getvalue()

    def get_media_data_url(self, path_str: str, max_size: int = 360) -> dict[str, Any]:
        """Bridge helper returning a scaled JPEG data URL for an allowlisted image."""
        try:
            jpg_bytes = self.render_media_jpeg(path_str, max_size=max_size)
            b64 = base64.b64encode(jpg_bytes).decode("ascii")
            return {"ok": True, "data_url": f"data:image/jpeg;base64,{b64}"}
        except PermissionError as err:
            return {"ok": False, "error": str(err)}
        except Exception as err:
            return {"ok": False, "error": f"Could not preview image: {err}"}

    # ------------------------------------------------------------------
    # Global state & folder selection APIs
    # ------------------------------------------------------------------

    def ping(self) -> dict[str, Any]:
        """Simple bridge healthcheck for PyWebView initialization validation."""
        return {"ok": True, "version": _read_app_version(), "footer": SAFETY_FOOTER_TEXT}

    def get_app_state(self) -> dict[str, Any]:
        """Return overall app state, folder paths, safety text, and active job info."""
        with self._state_lock:
            plan_ready = sum(1 for m in self._current_plan if m.status == "ready")
            plan_skipped = sum(1 for m in self._current_plan if m.status == "skipped")
            plan_refused = sum(1 for m in self._current_plan if m.status == "refused")
            src_str = str(self._source_dir) if self._source_dir else ""
            dst_str = str(self._dest_dir) if self._dest_dir else ""
            has_plan = len(self._current_plan) > 0

        latest_run = self._find_latest_active_run_log()
        with self._job_lock:
            job_copy = dict(self._job_state)

        return {
            "ok": True,
            "version": _read_app_version(),
            "footer": SAFETY_FOOTER_TEXT,
            "source_dir": src_str,
            "dest_dir": dst_str,
            "has_active_plan": has_plan,
            "plan_counts": {
                "ready": plan_ready,
                "skipped": plan_skipped,
                "refused": plan_refused,
                "total": plan_ready + plan_skipped + plan_refused,
            },
            "can_undo": latest_run is not None and not job_copy["running"],
            "active_undo_run": latest_run.parent.name if latest_run else None,
            "unreadable_count": len(self._cluster_manager.unreadable),
            "corrupt_backup": (
                self._cluster_manager.corrupt_backup_path.name
                if self._cluster_manager.corrupt_backup_path
                else None
            ),
            "job": job_copy,
        }

    def set_folders(self, source_dir: str = "", dest_dir: str = "") -> dict[str, Any]:
        """Validate and store source and/or destination folders."""
        if self._is_job_running():
            return {"ok": False, "error": "Another task is currently running."}
        try:
            with self._state_lock:
                new_src = self._source_dir
                new_dst = self._dest_dir

                if source_dir is not None and source_dir.strip():
                    candidate_src = self._validate_clean_path_input(source_dir)
                    if not candidate_src.is_dir():
                        return {"ok": False, "error": f"Source folder does not exist: {candidate_src}"}
                    new_src = candidate_src

                if dest_dir is not None and dest_dir.strip():
                    candidate_dst = self._validate_clean_path_input(dest_dir)
                    new_dst = candidate_dst

                if new_src != self._source_dir or new_dst != self._dest_dir:
                    self._current_plan = []

                self._source_dir = new_src
                self._dest_dir = new_dst

                return {
                    "ok": True,
                    "source_dir": str(self._source_dir) if self._source_dir else "",
                    "dest_dir": str(self._dest_dir) if self._dest_dir else "",
                }
        except ValueError as err:
            return {"ok": False, "error": str(err)}

    def pick_folder(self, role: str = "source") -> dict[str, Any]:
        """Open native OS folder picker dialog and persist chosen source/dest folder."""
        if role not in ("source", "dest"):
            return {"ok": False, "error": f"Invalid folder role: {role}"}

        selected: str | None = None
        if self._folder_picker is not None:
            selected = self._folder_picker(role)
        elif self._window is not None:
            import webview

            dialog_type = getattr(webview, "FileDialog", None)
            folder_const = dialog_type.FOLDER if dialog_type else webview.FOLDER_DIALOG
            result = self._window.create_file_dialog(folder_const)
            if result and len(result) > 0:
                selected = str(result[0])
        else:
            return {"ok": False, "error": "Folder dialog unavailable without active window."}

        if not selected:
            return {"ok": True, "cancelled": True}

        if role == "source":
            res = self.set_folders(source_dir=selected, dest_dir="")
        else:
            res = self.set_folders(source_dir="", dest_dir=selected)
        res["cancelled"] = False
        res["selected"] = selected
        return res

    # ------------------------------------------------------------------
    # Room 1: Main Hall (Dashboard derived from real cache/plan/runs logs)
    # ------------------------------------------------------------------

    def get_main_hall_summary(self) -> dict[str, Any]:
        """Return dashboard metrics computed strictly from real runs/ state."""
        with self._faces_lock:
            self._reload_faces_if_idle()
            cache_items = list(self._cluster_manager.cache.items())
            group_sizes = self._people_manager.get_group_sizes()
            visible_groups = self._people_manager.get_visible_groups(group_sizes=group_sizes)
            unnamed_numbering = self._people_manager.get_unnamed_numbering(group_sizes=group_sizes)
            sorted_visible = self._people_manager.sort_groups(visible_groups, "Largest first", group_sizes=group_sizes)
            unreadable_count = len(self._cluster_manager.unreadable)

        named_people = sum(1 for g in visible_groups if g.get("name") or g.get("display_name"))
        unnamed_people = max(0, len(visible_groups) - named_people)
        needs_review = sum(1 for g in visible_groups if g.get("needs_review") and not g.get("name"))

        people_preview: list[dict[str, Any]] = []
        for g in sorted_visible[:8]:
            gid = g["id"]
            crop_paths = g.get("crop_paths", [])
            if not crop_paths and g.get("crop_path"):
                crop_paths = [g["crop_path"]]
            crop_url = self.media_url(crop_paths[0]) if crop_paths else None
            people_preview.append({
                "id": gid,
                "display_name": g.get("display_name") or g.get("name") or unnamed_numbering.get(gid, "Unnamed person"),
                "named": bool(g.get("name") or g.get("display_name")),
                "needs_review": bool(g.get("needs_review") and not g.get("name")),
                "size": group_sizes.get(gid, 0),
                "crop_url": crop_url,
            })

        cached_images = 0
        cached_videos = 0
        for cache_key, v in cache_items:
            # Older runs/faces.json cache records may omit "type"; infer safely from extension.
            media_type = v.get("type")
            if media_type == "video":
                cached_videos += 1
            elif media_type == "image":
                cached_images += 1
            else:
                suffix = Path(cache_key).suffix.lower()
                if suffix in VIDEO_EXTENSIONS:
                    cached_videos += 1
                else:
                    cached_images += 1
        total_cached_bytes = sum(int(v.get("size", 0) or 0) for _, v in cache_items)

        recent_logs = self.list_activity_logs().get("entries", [])[:6]
        app_state = self.get_app_state()
        size_label = (
            "Unknown"
            if len(cache_items) > 0 and total_cached_bytes == 0
            else _format_size(total_cached_bytes)
        )

        return {
            "ok": True,
            "indexed_total": len(cache_items),
            "indexed_images": cached_images,
            "indexed_videos": cached_videos,
            "indexed_bytes": total_cached_bytes,
            "indexed_size_formatted": size_label,
            "visible_people": len(visible_groups),
            "named_people": named_people,
            "unnamed_people": unnamed_people,
            "needs_review_count": needs_review,
            "unreadable_count": unreadable_count,
            "people_preview": people_preview,
            "recent_activity": recent_logs,
            "app_state": app_state,
        }

    # ------------------------------------------------------------------
    # Room 2: Magical Library (Top-level source file browser)
    # ------------------------------------------------------------------

    def list_source_files(
        self,
        query: str = "",
        file_type: str = "all",
        page: int | None = None,
        page_size: int = 60,
    ) -> dict[str, Any]:
        """List top-level files in selected source directory (top-level scan only).

        Supports search by filename, type filter ('all', 'image', 'video', 'other'),
        and optional pagination (`page`, `page_size`) to avoid serializing huge directories.
        Subfolders are intentionally skipped per Nexora's top-level safety rule.
        """
        with self._state_lock:
            src = self._source_dir

        if src is None or not src.is_dir():
            return {
                "ok": True,
                "has_source": False,
                "source_dir": "",
                "files": [],
                "total_top_level": 0,
                "filtered_count": 0,
                "page": 1,
                "total_pages": 1,
                "type_counts": {"all": 0, "image": 0, "video": 0, "other": 0},
                "subfolders_skipped": 0,
                "note": "Top-level files only. Subfolders are skipped by placement policy.",
            }

        q = (query or "").strip().lower()
        try:
            entries = sorted(src.iterdir(), key=lambda p: p.name.lower())
        except OSError as err:
            return {
                "ok": False,
                "has_source": True,
                "source_dir": str(src),
                "files": [],
                "total_top_level": 0,
                "filtered_count": 0,
                "page": 1,
                "total_pages": 1,
                "type_counts": {"all": 0, "image": 0, "video": 0, "other": 0},
                "subfolders_skipped": 0,
                "error": f"Could not read source folder: {err}",
            }

        matched_entries: list[tuple[Path, str, str]] = []
        subfolders_skipped = 0
        total_files = 0
        type_counts = {"all": 0, "image": 0, "video": 0, "other": 0}

        for entry in entries:
            if entry.is_dir():
                subfolders_skipped += 1
                continue
            if not entry.is_file():
                continue
            total_files += 1

            ext = entry.suffix.lower()
            if ext in IMAGE_EXTENSIONS:
                ftype = "image"
            elif ext in VIDEO_EXTENSIONS:
                ftype = "video"
            else:
                ftype = "other"

            type_counts["all"] += 1
            type_counts[ftype] += 1

            if file_type in ("image", "video", "other") and ftype != file_type:
                continue
            if q and q not in entry.name.lower():
                continue
            matched_entries.append((entry, ftype, ext))

        filtered_total = len(matched_entries)
        if page is not None:
            safe_size = max(1, min(int(page_size or 60), 200))
            total_pages = max(1, (filtered_total + safe_size - 1) // safe_size)
            safe_page = max(1, min(int(page or 1), total_pages))
            start_idx = (safe_page - 1) * safe_size
            slice_entries = matched_entries[start_idx : start_idx + safe_size]
        else:
            safe_page = 1
            total_pages = 1
            slice_entries = matched_entries

        items: list[dict[str, Any]] = []
        for entry, ftype, ext in slice_entries:
            try:
                sz = entry.stat().st_size
            except OSError:
                sz = 0

            name_guess = extract_name(entry.name) if is_image_or_video(entry.name) else None
            rule_hint = (
                f"Name rule: {name_guess}/"
                if name_guess
                else ("Supported media" if is_image_or_video(entry.name) else "Skipped (other file)")
            )

            items.append({
                "name": entry.name,
                "path": str(entry.resolve()),
                "type": ftype,
                "extension": ext or "(none)",
                "size": sz,
                "size_formatted": _format_size(sz),
                "rule_hint": rule_hint,
                "preview_url": self.media_url(entry) if ftype == "image" else None,
            })

        return {
            "ok": True,
            "has_source": True,
            "source_dir": str(src),
            "files": items,
            "total_top_level": total_files,
            "filtered_count": filtered_total,
            "page": safe_page,
            "total_pages": total_pages,
            "type_counts": type_counts,
            "subfolders_skipped": subfolders_skipped,
            "note": "Top-level files only. Subfolders are skipped by placement policy.",
        }

    def inspect_source_file(self, path_str: str) -> dict[str, Any]:
        """Return safe read-only metadata and preview info for one top-level source file.

        Strictly validates that the target sits directly inside `_source_dir`
        and reads only real Nexora metadata (EXIF DateTimeOriginal, image dimensions,
        name-rule candidate, and runs/faces.json scan cache). Never uses file mtime/ctime.
        """
        try:
            resolved = self._validate_clean_path_input(path_str)
        except ValueError as err:
            return {"ok": False, "error": str(err)}

        with self._state_lock:
            src = self._source_dir

        if src is None or not src.is_dir():
            return {"ok": False, "error": "Select a source folder first."}

        try:
            src_resolved = src.resolve()
        except OSError as err:
            return {"ok": False, "error": f"Source folder unavailable: {err}"}

        if not resolved.is_file() or resolved.parent != src_resolved:
            return {
                "ok": False,
                "error": "Access denied: Magical Library can inspect only top-level files inside the selected source folder.",
            }

        ext = resolved.suffix.lower()
        if ext in IMAGE_EXTENSIONS:
            ftype = "image"
        elif ext in VIDEO_EXTENSIONS:
            ftype = "video"
        else:
            ftype = "other"

        try:
            sz = resolved.stat().st_size
        except OSError:
            sz = 0

        supported = is_image_or_video(resolved.name)
        name_candidate = extract_name(resolved.name) if supported else None

        dimensions: str | None = None
        exif_date: str | None = None
        exif_folder: str | None = None
        image_error: str | None = None
        preview_url: str | None = None
        preview_note = ""

        if ftype == "image":
            dt = capture_date(resolved)
            if dt is not None:
                exif_date = dt.strftime("%Y-%m-%d %H:%M:%S")
                exif_folder = f"{dt.year:04d}/{dt.year:04d}-{dt.month:02d}/"
            try:
                with Image.open(resolved) as img:
                    transposed = ImageOps.exif_transpose(img) or img
                    w, h = transposed.size
                    dimensions = f"{w} × {h} px"
                preview_url = self.media_url(resolved)
            except Exception as err:
                image_error = f"Image could not be decoded for preview: {err}"
                preview_note = image_error
        elif ftype == "video":
            preview_note = (
                "Video playback is not built into the Magical Library. "
                "Videos never use metadata dates; sampled frames are checked only during Potion Workshop AI scans."
            )
        else:
            preview_note = (
                "Unsupported file format. Per Nexora safety rules, other files are skipped during move planning "
                "and are never modified or deleted."
            )

        # Look up any already-scanned face cache / person associations in runs/faces.json
        with self._faces_lock:
            self._reload_faces_if_idle()
            face_lookup = self._lookup_cache_and_faces(resolved)
            resolved_key = str(resolved)
            norm_key = os.path.normcase(resolved_key)
            matched_gids = self._people_manager.file_groups.get(resolved_key)
            if matched_gids is None:
                matched_gids = next(
                    (gids for k, gids in list(self._people_manager.file_groups.items()) if os.path.normcase(k) == norm_key),
                    [],
                )
            named_folder_names = [
                (grp.get("name") or "").strip().lower()
                for gid in matched_gids
                for grp in list(self._cluster_manager.groups)
                if grp.get("id") == gid and (grp.get("name") or "").strip()
            ]

        people_labels = face_lookup["people_labels"]
        unreadable_reason = (
            "Recorded as unreadable during previous scan"
            if face_lookup["is_unreadable"]
            else None
        )

        # Explain expected placement order honestly without mutating state or creating targets
        if not supported:
            placement_summary = "Skipped (unsupported file type — never moved)"
        elif len(named_folder_names) == 1 and ftype == "image":
            placement_summary = f"Face rule (when planned) -> {named_folder_names[0]}/"
        elif len(named_folder_names) >= 2 and ftype == "image":
            placement_summary = "Face rule (when planned) -> Group photos/"
        elif name_candidate:
            placement_summary = f"Name rule -> {name_candidate}/"
        elif exif_folder and ftype == "image":
            placement_summary = f"EXIF capture date -> {exif_folder}"
        elif ftype == "video":
            placement_summary = "Unsorted/ (unless a named person matches >=2 sampled frames)"
        else:
            placement_summary = "Unsorted/ (until a known person is identified & named)"

        return {
            "ok": True,
            "file": {
                "name": resolved.name,
                "path": resolved_key,
                "type": ftype,
                "extension": ext or "(none)",
                "supported": supported,
                "size": sz,
                "size_formatted": _format_size(sz),
                "dimensions": dimensions,
                "exif_date": exif_date,
                "exif_folder": exif_folder,
                "name_rule_candidate": name_candidate,
                "placement_summary": placement_summary,
                "preview_url": preview_url,
                "preview_note": preview_note,
                "image_error": image_error,
                "scan_cache": {
                    "cached": face_lookup["cached"],
                    "faces_detected": face_lookup["faces_detected"],
                    "people_labels": people_labels,
                    "unreadable_reason": unreadable_reason,
                },
            },
            "safety_note": "Read-only inspection. Real placement runs only in Potion Workshop after Preview and Approve.",
        }

    # ------------------------------------------------------------------
    # Room 3: Photo Garden (Overview, Gallery, People cards, Guarded Ops)
    # ------------------------------------------------------------------

    def _lookup_cache_and_faces(
        self,
        resolved: Path,
        group_sizes: dict[str, int] | None = None,
        unnamed_nums: dict[str, str] | None = None,
        *,
        cache_by_norm: dict[str, dict[str, Any]] | None = None,
        file_groups_norm: dict[str, list[str]] | None = None,
        unreadable_norm: set[str] | None = None,
        groups_by_id: dict[str, dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """Look up existing faces.json cache, unreadable status, and labels for one resolved path."""
        resolved_key = str(resolved)
        norm_key = os.path.normcase(resolved_key)

        if cache_by_norm is not None:
            cache_entry = cache_by_norm.get(norm_key)
        else:
            cache_entry = self._cluster_manager.cache.get(resolved_key)
            if cache_entry is None:
                cache_entry = next(
                    (val for k, val in self._cluster_manager.cache.items() if os.path.normcase(k) == norm_key),
                    None,
                )

        if unreadable_norm is not None:
            is_unreadable = norm_key in unreadable_norm
        else:
            is_unreadable = resolved_key in self._cluster_manager.unreadable or any(
                os.path.normcase(u) == norm_key for u in self._cluster_manager.unreadable
            )
        if cache_entry and cache_entry.get("status") == "could not read":
            is_unreadable = True

        if file_groups_norm is not None:
            matched_gids = file_groups_norm.get(norm_key, [])
        else:
            matched_gids = self._people_manager.file_groups.get(resolved_key)
            if matched_gids is None:
                matched_gids = next(
                    (gids for k, gids in self._people_manager.file_groups.items() if os.path.normcase(k) == norm_key),
                    [],
                )

        if group_sizes is None:
            group_sizes = self._people_manager.get_group_sizes()
        if unnamed_nums is None:
            unnamed_nums = self._people_manager.get_unnamed_numbering(group_sizes=group_sizes)

        people_labels: list[str] = []
        for gid in matched_gids:
            grp = (
                groups_by_id.get(gid)
                if groups_by_id is not None
                else next((g for g in self._cluster_manager.groups if g.get("id") == gid), None)
            )
            if not grp:
                continue
            label = grp.get("display_name") or grp.get("name") or unnamed_nums.get(gid, "Unnamed person")
            people_labels.append(label)

        faces_detected = len(cache_entry.get("faces", [])) if cache_entry else 0
        if is_unreadable:
            face_status = "unreadable"
        elif cache_entry is not None:
            face_status = "faces_found" if faces_detected > 0 else "no_faces"
        else:
            face_status = "unscanned"

        return {
            "cached": cache_entry is not None,
            "is_unreadable": is_unreadable,
            "faces_detected": faces_detected,
            "face_status": face_status,
            "people_labels": people_labels,
        }

    def get_garden_gallery(
        self,
        query: str = "",
        image_filter: str = "all",
        page: int = 1,
        page_size: int = 48,
    ) -> dict[str, Any]:
        """Return paginated top-level source image gallery for Photo Garden.

        Never exposes arbitrary filesystem paths; checks resolved symlinks strictly
        remain inside active source directory and reads EXIF capture dates only for
        the current page slice.
        """
        with self._state_lock:
            src = self._source_dir

        if src is None or not src.is_dir():
            return {
                "ok": True,
                "has_source": False,
                "items": [],
                "total_matching": 0,
                "page": 1,
                "total_pages": 1,
                "page_size": max(1, min(int(page_size or 48), 100)),
                "filter_counts": {"all": 0, "with_faces": 0, "no_faces": 0, "unscanned": 0, "unreadable": 0},
                "unsupported_source_count": 0,
                "subfolders_skipped": 0,
            }

        with self._faces_lock:
            self._reload_faces_if_idle()
            group_sizes = self._people_manager.get_group_sizes()
            unnamed_nums = self._people_manager.get_unnamed_numbering(group_sizes=group_sizes)
            cache_by_norm = {os.path.normcase(k): v for k, v in self._cluster_manager.cache.items()}
            file_groups_norm = {os.path.normcase(k): gids for k, gids in self._people_manager.file_groups.items()}
            unreadable_norm = {os.path.normcase(u) for u in self._cluster_manager.unreadable}
            groups_by_id = {g["id"]: g for g in self._cluster_manager.groups if isinstance(g, dict) and g.get("id")}

            try:
                src_resolved = src.resolve()
                entries = sorted(src.iterdir(), key=lambda p: p.name.lower())
            except OSError as err:
                return {"ok": False, "has_source": True, "error": f"Could not read source folder: {err}"}

            q = (query or "").strip().lower()
            safe_page_size = max(1, min(int(page_size or 48), 100))
            safe_page = max(1, int(page or 1))
            valid_filter = image_filter if image_filter in ("all", "with_faces", "no_faces", "unscanned", "unreadable") else "all"

            counts = {"all": 0, "with_faces": 0, "no_faces": 0, "unscanned": 0, "unreadable": 0}
            unsupported_count = 0
            subfolders_skipped = 0
            matched_entries: list[tuple[Path, dict[str, Any]]] = []

            for entry in entries:
                if entry.is_dir():
                    subfolders_skipped += 1
                    continue
                try:
                    resolved = entry.resolve()
                except OSError:
                    continue
                # Reject symlinks pointing outside active source directory and non-files
                if resolved.parent != src_resolved or not resolved.is_file():
                    continue

                ext = resolved.suffix.lower()
                if ext not in IMAGE_EXTENSIONS:
                    if ext not in VIDEO_EXTENSIONS:
                        unsupported_count += 1
                    continue

                info = self._lookup_cache_and_faces(
                    resolved,
                    group_sizes=group_sizes,
                    unnamed_nums=unnamed_nums,
                    cache_by_norm=cache_by_norm,
                    file_groups_norm=file_groups_norm,
                    unreadable_norm=unreadable_norm,
                    groups_by_id=groups_by_id,
                )
                counts["all"] += 1
                if info["is_unreadable"]:
                    counts["unreadable"] += 1
                elif not info["cached"]:
                    counts["unscanned"] += 1
                elif info["faces_detected"] > 0:
                    counts["with_faces"] += 1
                else:
                    counts["no_faces"] += 1

                if valid_filter == "with_faces" and (info["is_unreadable"] or info["faces_detected"] <= 0):
                    continue
                if valid_filter == "no_faces" and (info["is_unreadable"] or not info["cached"] or info["faces_detected"] != 0):
                    continue
                if valid_filter == "unscanned" and (info["is_unreadable"] or info["cached"]):
                    continue
                if valid_filter == "unreadable" and not info["is_unreadable"]:
                    continue

                if q and q not in entry.name.lower():
                    continue

                matched_entries.append((resolved, info))

            origin = "fresh_scan" if self._fresh_scan_in_session else ("cached" if self._cluster_manager.cache else "source_only")

        total_matching = len(matched_entries)
        total_pages = max(1, (total_matching + safe_page_size - 1) // safe_page_size)
        if safe_page > total_pages:
            safe_page = total_pages

        start_idx = (safe_page - 1) * safe_page_size
        page_slice = matched_entries[start_idx : start_idx + safe_page_size]

        items: list[dict[str, Any]] = []
        for resolved, info in page_slice:
            try:
                sz = resolved.stat().st_size
            except OSError:
                sz = 0
            dt = capture_date(resolved) if not info["is_unreadable"] else None
            items.append({
                "name": resolved.name,
                "extension": resolved.suffix.lower() or "(none)",
                "size_formatted": _format_size(sz),
                "capture_date": dt.strftime("%Y-%m-%d %H:%M") if dt else None,
                "face_status": info["face_status"],
                "faces_detected": info["faces_detected"],
                "people_labels": info["people_labels"],
                "thumbnail_url": None if info["is_unreadable"] else self.media_url(resolved),
                "data_origin": origin,
            })

        return {
            "ok": True,
            "has_source": True,
            "items": items,
            "total_matching": total_matching,
            "page": safe_page,
            "page_size": safe_page_size,
            "total_pages": total_pages,
            "filter_counts": counts,
            "unsupported_source_count": unsupported_count,
            "subfolders_skipped": subfolders_skipped,
        }

    def get_people_state(self, query: str = "", sort_by: str = "Largest first") -> dict[str, Any]:
        """Return visible face groups, garden overview stats, suggestions, withheld, and unreadable report."""
        with self._faces_lock:
            self._reload_faces_if_idle()
            group_sizes = self._people_manager.get_group_sizes()
            visible = self._people_manager.get_visible_groups(group_sizes=group_sizes)
            unnamed_numbering = self._people_manager.get_unnamed_numbering(group_sizes=group_sizes)
            filtered = self._people_manager.filter_groups(visible, query, group_sizes=group_sizes)
            sorted_groups = self._people_manager.sort_groups(filtered, sort_by, group_sizes=group_sizes)
            file_groups_snapshot = list(self._people_manager.file_groups.items())
            raw_suggestions, total_suggestions = self._people_manager.get_merge_suggestions()
            withheld = self._people_manager.get_withheld_photos_report()
            cache_snapshot = list(self._cluster_manager.cache.items())
            unreadable_snapshot = set(self._cluster_manager.unreadable)
            groups_nonempty = bool(self._cluster_manager.groups)

        cards: list[dict[str, Any]] = []
        for g in sorted_groups:
            gid = g["id"]
            display_name = g.get("display_name") or g.get("name") or unnamed_numbering.get(gid, "Unnamed person")
            folder_name = (g.get("name") or "").strip().lower()
            needs_review = bool(g.get("needs_review", False))

            crop_paths = g.get("crop_paths", [])
            if not crop_paths and g.get("crop_path"):
                crop_paths = [g["crop_path"]]

            crop_urls = [url for url in (self.media_url(cp) for cp in crop_paths[:6]) if url]
            group_files = sorted({Path(fk).name for fk, gids in file_groups_snapshot if gid in gids})

            if needs_review and not folder_name:
                placement_status = "Withheld (needs review - large group: name it to use it)"
                placement_state = "needs_review"
                identity_status = "detected_needs_review"
            elif not folder_name:
                placement_status = "Withheld (unnamed - name it to use it)"
                placement_state = "unnamed"
                identity_status = "detected_unnamed"
            else:
                placement_status = f"Confirmed -> folder '{folder_name}/'"
                placement_state = "active"
                identity_status = "confirmed"

            face_count = group_sizes.get(gid, 0)
            cards.append({
                "id": gid,
                "display_name": display_name,
                "folder_name": folder_name,
                "assigned_name": g.get("display_name") or g.get("name") or "",
                "size": face_count,
                "face_count": face_count,
                "needs_review": needs_review,
                "placement_status": placement_status,
                "placement_state": placement_state,
                "identity_status": identity_status,
                "crop_urls": crop_urls,
                "sample_files": group_files[:6],
                "total_files": len(group_files),
                "merge_targets": [og["id"] for og in visible if og["id"] != gid],
            })

        serialized_suggestions = []
        for s in raw_suggestions:
            serialized_suggestions.append({
                "group_a_id": s["group_a_id"],
                "group_b_id": s["group_b_id"],
                "group_a_name": s["group_a_name"],
                "group_b_name": s["group_b_name"],
                "group_a_photos": s["group_a_photos"],
                "group_b_photos": s["group_b_photos"],
                "group_a_crop_url": self.media_url(s.get("group_a_crop")),
                "group_b_crop_url": self.media_url(s.get("group_b_crop")),
                "similarity": round(float(s["similarity"]), 3),
            })

        # Real cached overview counters (never invented)
        total_cached_images = 0
        images_with_faces = 0
        no_faces_names: list[str] = []
        unreadable_norm = {os.path.normcase(u) for u in unreadable_snapshot}

        for ck, cval in cache_snapshot:
            if not isinstance(cval, dict):
                continue
            ctype = cval.get("type")
            is_video = ctype == "video" or (not ctype and Path(ck).suffix.lower() in VIDEO_EXTENSIONS)
            if is_video:
                continue
            if os.path.normcase(ck) in unreadable_norm or cval.get("status") == "could not read":
                continue
            total_cached_images += 1
            faces_list = cval.get("faces", []) or []
            if len(faces_list) > 0:
                images_with_faces += 1
            else:
                no_faces_names.append(Path(ck).name)

        no_faces_names = sorted(set(no_faces_names))
        named_people_count = sum(1 for g in visible if (g.get("name") or "").strip())
        unnamed_groups_count = max(0, len(visible) - named_people_count)
        needs_review_groups_count = sum(
            1 for g in visible if g.get("needs_review") and not (g.get("name") or "").strip()
        )

        with self._state_lock:
            src = self._source_dir
        unsupported_count: int | None = None
        has_source = src is not None and src.is_dir()
        if has_source:
            try:
                unsupported_count = sum(
                    1
                    for p in src.iterdir()
                    if p.is_file() and not is_image_or_video(p.name)
                )
            except OSError:
                unsupported_count = None

        cache_exists = self._cluster_manager.json_path.exists()
        if self._fresh_scan_in_session:
            data_origin = "fresh_scan"
            cache_source_label = "Fresh scan completed in this session (saved to runs/faces.json)"
        elif cache_exists and (cache_snapshot or groups_nonempty or unreadable_snapshot):
            data_origin = "cached"
            cache_source_label = "Loaded from saved cache (runs/faces.json)"
        else:
            data_origin = "empty"
            cache_source_label = "No face scan cache recorded yet"

        corrupt_name = (
            self._cluster_manager.corrupt_backup_path.name
            if self._cluster_manager.corrupt_backup_path
            else self._last_corrupt_backup_name
        )
        if corrupt_name:
            self._last_corrupt_backup_name = corrupt_name

        return {
            "ok": True,
            "total_visible": len(visible),
            "cards": cards,
            "suggestions": serialized_suggestions,
            "total_suggestions": total_suggestions,
            "overview": {
                "total_cached_images": total_cached_images,
                "images_with_faces": images_with_faces,
                "images_without_faces": len(no_faces_names),
                "visible_people": len(visible),
                "named_people": named_people_count,
                "unnamed_awaiting_review": unnamed_groups_count,
                "needs_review_groups": needs_review_groups_count,
                "unreadable_count": len(unreadable_snapshot),
                "unsupported_source_count": unsupported_count,
                "has_source": has_source,
                "cache_exists": cache_exists,
                "data_origin": data_origin,
                "cache_source_label": cache_source_label,
                "corrupt_backup": corrupt_name,
            },
            "withheld": {
                "needs_review_count": len({x["file_key"] for x in withheld["needs_review"]}),
                "unnamed_count": len({x["file_key"] for x in withheld["unnamed"]}),
                "hidden_group_count": len({x["file_key"] for x in withheld["hidden_group"]}),
                "needs_review_samples": sorted({x["file_name"] for x in withheld["needs_review"]})[:12],
                "unnamed_samples": sorted({x["file_name"] for x in withheld["unnamed"]})[:12],
                "hidden_group_samples": sorted({x["file_name"] for x in withheld["hidden_group"]})[:12],
                "no_faces_count": len(no_faces_names),
                "no_faces_samples": no_faces_names[:20],
            },
            "unreadable": sorted(unreadable_snapshot),
            "unreadable_items": sorted({Path(u).name for u in unreadable_snapshot}),
        }

    def name_group(self, group_id: str, name: str) -> dict[str, Any]:
        """Validate and assign a person name to a face group via PeopleManager."""
        if self._is_scan_running():
            return {"ok": False, "error": "Cannot modify people groups while a face scan is running."}
        if not isinstance(group_id, str) or not group_id.strip():
            return {"ok": False, "error": "Invalid group identifier."}
        try:
            with self._faces_lock:
                saved = self._people_manager.name_group(group_id, name)
                self._last_faces_stat = self._read_faces_stat()
            return {"ok": True, "saved_name": saved}
        except ValueError as err:
            return {"ok": False, "error": str(err)}

    def split_group(self, group_id: str) -> dict[str, Any]:
        """Split a mixed face group into two clusters via PeopleManager."""
        if self._is_scan_running():
            return {"ok": False, "error": "Cannot modify people groups while a face scan is running."}
        if not isinstance(group_id, str) or not group_id.strip():
            return {"ok": False, "error": "Invalid group identifier."}
        try:
            with self._faces_lock:
                orig_id, new_id = self._people_manager.split_group(group_id)
                self._last_faces_stat = self._read_faces_stat()
            return {"ok": True, "original_id": orig_id, "new_id": new_id}
        except ValueError as err:
            return {"ok": False, "error": str(err)}

    def check_merge_guard(self, target_group_id: str, source_group_id: str) -> dict[str, Any]:
        """Validate group IDs and check if merging triggers small-cluster confirmation."""
        if not isinstance(target_group_id, str) or not isinstance(source_group_id, str):
            return {"ok": False, "error": "Invalid group identifier."}
        with self._faces_lock:
            existing_ids = {g.get("id") for g in self._cluster_manager.groups}
            if target_group_id not in existing_ids:
                return {"ok": False, "error": f"Target group not found: {target_group_id}"}
            if source_group_id not in existing_ids:
                return {"ok": False, "error": f"Source group not found: {source_group_id}"}
            if target_group_id == source_group_id:
                return {"ok": False, "error": "Cannot merge a group into itself."}

            sizes = self._people_manager.get_group_sizes()
            refused = self._people_manager.would_guard_refuse_merge(target_group_id, source_group_id)
            n_faces = sizes.get(source_group_id, 0)
            m_faces = sizes.get(target_group_id, 0)
            target_name = self._people_manager.get_group_display_name(target_group_id)
            source_name = self._people_manager.get_group_display_name(source_group_id)
        return {
            "ok": True,
            "needs_confirmation": refused,
            "source_size": n_faces,
            "target_size": m_faces,
            "source_name": source_name,
            "target_name": target_name,
            "message": f"This merges {n_faces} faces into a group of {m_faces} faces. Continue?",
            "risk_note": (
                "Small-cluster safety warning: merging a larger cluster into a tiny (<=3 face) cluster "
                "can mix two different people together if their faces do not truly match."
                if refused
                else ""
            ),
        }

    def merge_groups(
        self,
        target_group_id: str,
        source_group_id: str,
        confirmed_override: bool = False,
    ) -> dict[str, Any]:
        """Merge source_group into target_group, requiring explicit override if guard fires."""
        if self._is_scan_running():
            return {"ok": False, "error": "Cannot modify people groups while a face scan is running."}
        with self._faces_lock:
            guard = self.check_merge_guard(target_group_id, source_group_id)
            if not guard.get("ok"):
                return guard
            if guard["needs_confirmation"] and not confirmed_override:
                return {
                    "ok": False,
                    "needs_confirmation": True,
                    "source_size": guard["source_size"],
                    "target_size": guard["target_size"],
                    "error": guard["message"],
                    "risk_note": guard["risk_note"],
                }
            merged_ok = self._people_manager.merge_groups(
                target_group_id, source_group_id, is_automatic=False
            )
            self._last_faces_stat = self._read_faces_stat()
            return {"ok": bool(merged_ok), "target_group_id": target_group_id}

    def dismiss_suggested_merge(self, group_id_a: str, group_id_b: str) -> dict[str, Any]:
        """Validate group identifiers and record a suggested merge pair as dismissed."""
        if self._is_scan_running():
            return {"ok": False, "error": "Cannot modify people groups while a face scan is running."}
        if not isinstance(group_id_a, str) or not isinstance(group_id_b, str):
            return {"ok": False, "error": "Invalid group identifier."}
        with self._faces_lock:
            existing_ids = {g.get("id") for g in self._cluster_manager.groups}
            if group_id_a not in existing_ids or group_id_b not in existing_ids:
                return {"ok": False, "error": "One or both suggested groups were not found."}
            if group_id_a == group_id_b:
                return {"ok": False, "error": "Cannot dismiss a group paired with itself."}
            self._people_manager.dismiss_merge(group_id_a, group_id_b)
            self._last_faces_stat = self._read_faces_stat()
        return {"ok": True}

    # ------------------------------------------------------------------
    # Room 4: Crystal Chamber (Unsupported/Safety policy documentation only)
    # ------------------------------------------------------------------

    def get_crystal_chamber_status(self) -> dict[str, Any]:
        """Document that duplicate detection and deletion are unsupported per safety policy."""
        return {
            "ok": True,
            "supported": False,
            "title": "Crystal Chamber — Deletion & Duplicate Guard",
            "summary": (
                "Duplicate detection and file deletion are intentionally disabled in Nexora."
            ),
            "details": [
                "Safety Rule: Nexora never deletes user files and never overwrites existing targets.",
                "Product Scope: Duplicate detection and deletion are out of scope in PRD v2.0.",
                "Instead of deletion, duplicate filenames during organization receive safe numeric suffixes.",
            ],
        }

    # ------------------------------------------------------------------
    # Room 5: Potion Workshop (Scan, Preview Plan, Approve Move, Reject)
    # ------------------------------------------------------------------

    def _begin_job(self, kind: str, status_text: str) -> bool:
        with self._job_lock:
            if self._job_state["running"]:
                return False
            self._job_state = {
                "kind": kind,
                "running": True,
                "scanned": 0,
                "total": 0,
                "faces": 0,
                "percent": 0,
                "status_text": status_text,
                "error": None,
                "last_result": None,
            }
            return True

    def _finish_job(self, status_text: str, result: dict[str, Any] | None = None, error: str | None = None) -> None:
        with self._job_lock:
            self._job_state["running"] = False
            self._job_state["status_text"] = status_text
            self._job_state["error"] = error
            self._job_state["last_result"] = result
            if error is None:
                self._job_state["percent"] = 100

    def get_job_status(self) -> dict[str, Any]:
        """Poll current background operation state cleanly from JS."""
        with self._job_lock:
            return {"ok": True, **self._job_state}

    def start_scan(self) -> dict[str, Any]:
        """Start background stoppable face detection/clustering scan on source folder."""
        with self._state_lock:
            src = self._source_dir
        if src is None or not src.is_dir():
            return {"ok": False, "error": "Please select a valid source folder first."}

        if not self._begin_job("scan", "Scanning images and videos for people..."):
            return {"ok": False, "error": "Another task is currently running."}

        self._scan_stop_event = threading.Event()

        def on_progress(scanned: int, total: int, faces: int) -> None:
            with self._job_lock:
                self._job_state["scanned"] = scanned
                self._job_state["total"] = total
                self._job_state["faces"] = faces
                self._job_state["percent"] = int((scanned / max(total, 1)) * 100)
                self._job_state["status_text"] = f"Scanned {scanned} of {total}. Results saved."

        def worker() -> None:
            try:
                summary = self._cluster_manager.scan_source(
                    src,
                    progress_callback=on_progress,
                    stop_event=self._scan_stop_event,
                )
                with self._faces_lock:
                    self._last_faces_stat = self._read_faces_stat()
                self._fresh_scan_in_session = True
                msg = (
                    f"People scan complete: {summary['images_scanned']} files scanned, "
                    f"{summary['faces_found']} faces across {summary['groups_count']} groups."
                )
                self._finish_job(msg, result=summary)
            except Exception as err:
                self._finish_job("Scan error", error=str(err))

        threading.Thread(target=worker, daemon=True).start()
        return {"ok": True, "started": True}

    def stop_scan(self) -> dict[str, Any]:
        """Signal the active background scan to stop cleanly after the current batch."""
        if self._scan_stop_event is not None:
            self._scan_stop_event.set()
            with self._job_lock:
                self._job_state["status_text"] = "Stopping scan after current batch..."
            return {"ok": True}
        return {"ok": False, "error": "No scan is running."}

    def build_preview(self) -> dict[str, Any]:
        """Generate a move preview plan synchronously/safely from validated folders."""
        if self._is_job_running():
            return {"ok": False, "error": "Another task is currently running."}
        with self._state_lock:
            src = self._source_dir
            dst = self._dest_dir
        if src is None or dst is None:
            return {"ok": False, "error": "Please select both source and destination folders."}

        try:
            with self._faces_lock:
                self._reload_faces_if_idle()
                face_data = self._people_manager.get_face_data_for_plan()
            plan = build_plan(src, dst, face_data=face_data)
            with self._state_lock:
                self._current_plan = plan
            return self.get_preview_state()
        except Exception as err:
            with self._state_lock:
                self._current_plan = []
            return {"ok": False, "error": str(err)}

    def get_preview_state(self) -> dict[str, Any]:
        """Return serialized rows and KPI summary for the active planned moves."""
        with self._state_lock:
            plan = list(self._current_plan)

        rows: list[dict[str, Any]] = []
        ready_count = 0
        skipped_count = 0
        refused_count = 0

        for m in plan:
            if m.status == "ready":
                ready_count += 1
            elif m.status == "skipped":
                skipped_count += 1
            elif m.status == "refused":
                refused_count += 1

            target_display = os.path.normpath(str(m.target)) if m.status != "skipped" else "-"
            rows.append({
                "source_name": os.path.normpath(m.source.name),
                "target_display": target_display,
                "matched_by": m.matched_by,
                "size": m.size,
                "size_formatted": _format_size(m.size),
                "status": m.status,
                "reason": m.reason,
            })

        return {
            "ok": True,
            "counts": {
                "ready": ready_count,
                "skipped": skipped_count,
                "refused": refused_count,
                "total": len(plan),
            },
            "rows": rows,
        }

    def reject_preview(self) -> dict[str, Any]:
        """Clear the active preview plan without touching any files."""
        if self._is_job_running():
            return {"ok": False, "error": "Another task is currently running."}
        with self._state_lock:
            self._current_plan = []
        return {"ok": True, "cleared": True}

    def approve_move(self, confirmed: bool = False) -> dict[str, Any]:
        """Execute SHA-256 verified moves for active preview after explicit user confirmation."""
        if confirmed is not True:
            return {
                "ok": False,
                "error": "Explicit user confirmation is required before moving files.",
            }

        with self._state_lock:
            plan = list(self._current_plan)

        ready_moves = [m for m in plan if m.status == "ready"]
        if not ready_moves:
            return {"ok": False, "error": "There are no files ready to move. Run Preview first."}

        if not self._begin_job("move", "Moving files with SHA-256 verification..."):
            return {"ok": False, "error": "Another task is currently running."}

        run_folder = create_unique_run_folder(self._runs_dir)
        log_path = run_folder / "run.log"

        def worker() -> None:
            try:
                summary = run_plan(plan, log_path)
                with self._state_lock:
                    self._current_plan = []
                if summary.get("stopped"):
                    self._finish_job(
                        f"Stopped: {summary.get('reason')}",
                        result=summary,
                        error=summary.get("reason"),
                    )
                else:
                    self._finish_job(
                        f"Run completed: {summary.get('moved')} moved, {summary.get('skipped')} skipped.",
                        result=summary,
                    )
            except Exception as err:
                with self._state_lock:
                    self._current_plan = []
                self._finish_job("Move failed", error=str(err))

        threading.Thread(target=worker, daemon=True).start()
        return {"ok": True, "started": True, "ready_count": len(ready_moves)}

    # ------------------------------------------------------------------
    # Room 6 & 7: Memory Room (Logs Timeline) & Secret Vault (Undo/Recovery)
    # ------------------------------------------------------------------

    def list_activity_logs(self) -> dict[str, Any]:
        """Read run logs, undo records, scan logs, and corrupt backups from runs/."""
        entries: list[dict[str, Any]] = []
        if not self._runs_dir.exists():
            return {"ok": True, "entries": entries}

        # Run folders (move & undo logs)
        run_dirs = sorted(
            [d for d in self._runs_dir.iterdir() if d.is_dir() and d.name.startswith("run_")],
            key=lambda d: d.name,
            reverse=True,
        )
        for rdir in run_dirs:
            log_file = rdir / "run.log"
            undone_file = rdir / "undone.json"
            if not log_file.is_file():
                continue

            moved_items: list[dict[str, Any]] = []
            try:
                for line in log_file.read_text(encoding="utf-8").splitlines():
                    line = line.strip()
                    if line:
                        moved_items.append(json.loads(line))
            except Exception:
                pass

            undone_info = None
            if undone_file.is_file():
                try:
                    undone_info = json.loads(undone_file.read_text(encoding="utf-8"))
                except Exception:
                    undone_info = {"restored": 0}

            entries.append({
                "kind": "move_run",
                "id": rdir.name,
                "timestamp": moved_items[0].get("timestamp", rdir.name) if moved_items else rdir.name,
                "moved_count": len(moved_items),
                "undone": undone_info is not None,
                "restored_count": undone_info.get("restored", 0) if undone_info else 0,
                "samples": [
                    {
                        "original": Path(it.get("original", "")).name,
                        "moved_to": str(it.get("moved_to", "")),
                    }
                    for it in moved_items[:5]
                ],
            })

        # Scan logs
        scan_logs = sorted(
            [f for f in self._runs_dir.iterdir() if f.is_file() and f.name.startswith("scan-") and f.suffix == ".log"],
            key=lambda f: f.name,
            reverse=True,
        )
        for slog in scan_logs[:15]:
            summary_line = ""
            try:
                lines = [ln.strip() for ln in slog.read_text(encoding="utf-8").splitlines() if ln.strip()]
                if lines:
                    summary_line = lines[-1]
            except Exception:
                pass
            entries.append({
                "kind": "scan_log",
                "id": slog.name,
                "timestamp": slog.stem.replace("scan-", ""),
                "summary": summary_line or "Scan recorded",
            })

        entries.sort(key=lambda e: str(e.get("timestamp", "")), reverse=True)
        return {"ok": True, "entries": entries}

    def get_undo_status(self) -> dict[str, Any]:
        """Return latest active run log status and corrupt-file backup records."""
        latest_log = self._find_latest_active_run_log()
        move_count = 0
        if latest_log is not None:
            try:
                move_count = sum(
                    1 for ln in latest_log.read_text(encoding="utf-8").splitlines() if ln.strip()
                )
            except Exception:
                move_count = 0

        backups = sorted(
            [
                f.name
                for f in self._runs_dir.iterdir()
                if f.is_file() and f.name.startswith("faces.corrupt-") and f.suffix == ".json"
            ],
            reverse=True,
        )

        return {
            "ok": True,
            "has_active_run": latest_log is not None,
            "run_id": latest_log.parent.name if latest_log else None,
            "movable_count": move_count,
            "corrupt_backups": backups,
        }

    def execute_undo(self, confirmed: bool = False) -> dict[str, Any]:
        """Reverse the latest active run using undo_run() after confirmation."""
        if confirmed is not True:
            return {"ok": False, "error": "Explicit user confirmation is required before undo."}

        latest_log = self._find_latest_active_run_log()
        if latest_log is None:
            return {"ok": False, "error": "No previous run available to undo."}

        if not self._begin_job("undo", "Reversing previous run..."):
            return {"ok": False, "error": "Another task is currently running."}

        def worker() -> None:
            try:
                summary = undo_run(latest_log)
                if summary.get("stopped"):
                    self._finish_job(
                        f"Undo stopped: {summary.get('reason')}",
                        result=summary,
                        error=summary.get("reason"),
                    )
                else:
                    self._finish_job(
                        f"Undo completed: {summary.get('restored')} files restored.",
                        result=summary,
                    )
            except Exception as err:
                self._finish_job("Undo failed", error=str(err))

        threading.Thread(target=worker, daemon=True).start()
        return {"ok": True, "started": True, "run_id": latest_log.parent.name}
