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
from nexora.mover import run_plan
from nexora.names import IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, extract_name, is_image_or_video
from nexora.plan import PlannedMove, build_plan
from nexora.undo import undo_run

SAFETY_FOOTER_TEXT = "Files are moved, not copied. Nothing is deleted."


def _format_size(size_bytes: int) -> str:
    """Format byte size for human display (KB, MB, GB)."""
    kb = size_bytes / 1024.0
    if kb < 1024.0:
        return f"{kb:.1f} KB"
    mb = kb / 1024.0
    if mb < 1024.0:
        return f"{mb:.1f} MB"
    gb = mb / 1024.0
    return f"{gb:.1f} GB"


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

        self._job_lock = threading.Lock()
        self._scan_stop_event: threading.Event | None = None
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
        return "Ready inside the Living Treehouse"

    def _validate_clean_path_input(self, raw_path: str) -> Path:
        """Validate path string contains no null bytes and resolves cleanly."""
        if not isinstance(raw_path, str) or not raw_path.strip() or "\x00" in raw_path:
            raise ValueError("Invalid folder path.")
        return Path(raw_path.strip()).resolve()

    def _find_latest_active_run_log(self) -> Path | None:
        """Find newest run_<ts>/run.log that has not already been undone."""
        if not self._runs_dir.exists():
            return None
        run_dirs = sorted(
            [d for d in self._runs_dir.iterdir() if d.is_dir() and d.name.startswith("run_")],
            key=lambda d: d.name,
            reverse=True,
        )
        for rdir in run_dirs:
            log_file = rdir / "run.log"
            undone_file = rdir / "undone.json"
            if log_file.is_file() and not undone_file.exists():
                return log_file
        return None

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
        self._cluster_manager.load()
        group_sizes = self._people_manager.get_group_sizes()
        visible_groups = self._people_manager.get_visible_groups(group_sizes=group_sizes)

        named_people = sum(1 for g in visible_groups if g.get("name") or g.get("display_name"))
        needs_review = sum(1 for g in visible_groups if g.get("needs_review") and not g.get("name"))

        cached_images = sum(1 for v in self._cluster_manager.cache.values() if v.get("type") == "image")
        cached_videos = sum(1 for v in self._cluster_manager.cache.values() if v.get("type") == "video")
        total_cached_bytes = sum(int(v.get("size", 0) or 0) for v in self._cluster_manager.cache.values())

        recent_logs = self.list_activity_logs().get("entries", [])[:6]
        app_state = self.get_app_state()

        return {
            "ok": True,
            "indexed_total": len(self._cluster_manager.cache),
            "indexed_images": cached_images,
            "indexed_videos": cached_videos,
            "indexed_bytes": total_cached_bytes,
            "indexed_size_formatted": _format_size(total_cached_bytes),
            "visible_people": len(visible_groups),
            "named_people": named_people,
            "needs_review_count": needs_review,
            "unreadable_count": len(self._cluster_manager.unreadable),
            "recent_activity": recent_logs,
            "app_state": app_state,
        }

    # ------------------------------------------------------------------
    # Room 2: Magical Library (Top-level source file browser)
    # ------------------------------------------------------------------

    def list_source_files(self, query: str = "", file_type: str = "all") -> dict[str, Any]:
        """List top-level files in selected source directory (top-level scan only).

        Supports search by filename and type filter ('all', 'image', 'video', 'other').
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
                "subfolders_skipped": 0,
                "note": "Top-level files only. Subfolders are skipped by placement policy.",
            }

        q = (query or "").strip().lower()
        entries = sorted(src.iterdir(), key=lambda p: p.name.lower())

        items: list[dict[str, Any]] = []
        subfolders_skipped = 0
        total_files = 0

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

            if file_type in ("image", "video", "other") and ftype != file_type:
                continue
            if q and q not in entry.name.lower():
                continue

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
            "filtered_count": len(items),
            "subfolders_skipped": subfolders_skipped,
            "note": "Top-level files only. Subfolders are skipped by placement policy.",
        }

    # ------------------------------------------------------------------
    # Room 3: Photo Garden (People cards, search/sort, name/split/merge)
    # ------------------------------------------------------------------

    def get_people_state(self, query: str = "", sort_by: str = "Largest first") -> dict[str, Any]:
        """Return visible face groups, merge suggestions, withheld report, and unreadable list."""
        self._cluster_manager.load()
        group_sizes = self._people_manager.get_group_sizes()
        visible = self._people_manager.get_visible_groups(group_sizes=group_sizes)
        unnamed_numbering = self._people_manager.get_unnamed_numbering(group_sizes=group_sizes)
        filtered = self._people_manager.filter_groups(visible, query, group_sizes=group_sizes)
        sorted_groups = self._people_manager.sort_groups(filtered, sort_by, group_sizes=group_sizes)

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
            group_files = sorted({Path(fk).name for fk, gids in self._people_manager.file_groups.items() if gid in gids})

            if needs_review and not folder_name:
                placement_status = "Withheld (needs review - large group: name it to use it)"
                placement_state = "needs_review"
            elif not folder_name:
                placement_status = "Withheld (unnamed - name it to use it)"
                placement_state = "unnamed"
            else:
                placement_status = f"Active -> folder '{folder_name}/'"
                placement_state = "active"

            cards.append({
                "id": gid,
                "display_name": display_name,
                "folder_name": folder_name,
                "assigned_name": g.get("display_name") or g.get("name") or "",
                "size": group_sizes.get(gid, 0),
                "needs_review": needs_review,
                "placement_status": placement_status,
                "placement_state": placement_state,
                "crop_urls": crop_urls,
                "sample_files": group_files[:6],
                "total_files": len(group_files),
                "merge_targets": [og["id"] for og in visible if og["id"] != gid],
            })

        raw_suggestions, total_suggestions = self._people_manager.get_merge_suggestions()
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

        withheld = self._people_manager.get_withheld_photos_report()
        return {
            "ok": True,
            "total_visible": len(visible),
            "cards": cards,
            "suggestions": serialized_suggestions,
            "total_suggestions": total_suggestions,
            "withheld": {
                "needs_review_count": len({x["file_key"] for x in withheld["needs_review"]}),
                "unnamed_count": len({x["file_key"] for x in withheld["unnamed"]}),
                "hidden_group_count": len({x["file_key"] for x in withheld["hidden_group"]}),
                "needs_review_samples": sorted({x["file_name"] for x in withheld["needs_review"]})[:8],
                "unnamed_samples": sorted({x["file_name"] for x in withheld["unnamed"]})[:8],
                "hidden_group_samples": sorted({x["file_name"] for x in withheld["hidden_group"]})[:8],
            },
            "unreadable": sorted(self._cluster_manager.unreadable),
        }

    def name_group(self, group_id: str, name: str) -> dict[str, Any]:
        """Validate and assign a person name to a face group via PeopleManager."""
        try:
            saved = self._people_manager.name_group(group_id, name)
            return {"ok": True, "saved_name": saved}
        except ValueError as err:
            return {"ok": False, "error": str(err)}

    def split_group(self, group_id: str) -> dict[str, Any]:
        """Split a mixed face group into two clusters via PeopleManager."""
        try:
            orig_id, new_id = self._people_manager.split_group(group_id)
            return {"ok": True, "original_id": orig_id, "new_id": new_id}
        except ValueError as err:
            return {"ok": False, "error": str(err)}

    def check_merge_guard(self, target_group_id: str, source_group_id: str) -> dict[str, Any]:
        """Check if merging source into target triggers small-cluster confirmation."""
        refused = self._people_manager.would_guard_refuse_merge(target_group_id, source_group_id)
        n_faces = self._people_manager.get_group_size(source_group_id)
        m_faces = self._people_manager.get_group_size(target_group_id)
        return {
            "ok": True,
            "needs_confirmation": refused,
            "source_size": n_faces,
            "target_size": m_faces,
            "message": f"This merges {n_faces} faces into a group of {m_faces} faces. Continue?",
        }

    def merge_groups(
        self,
        target_group_id: str,
        source_group_id: str,
        confirmed_override: bool = False,
    ) -> dict[str, Any]:
        """Merge source_group into target_group, requiring explicit confirmation if guard fires."""
        guard = self.check_merge_guard(target_group_id, source_group_id)
        if guard["needs_confirmation"] and not confirmed_override:
            return {
                "ok": False,
                "needs_confirmation": True,
                "source_size": guard["source_size"],
                "target_size": guard["target_size"],
                "error": guard["message"],
            }
        merged_ok = self._people_manager.merge_groups(
            target_group_id, source_group_id, is_automatic=False
        )
        return {"ok": bool(merged_ok), "target_group_id": target_group_id}

    def dismiss_suggested_merge(self, group_id_a: str, group_id_b: str) -> dict[str, Any]:
        """Record a suggested merge pair as dismissed."""
        self._people_manager.dismiss_merge(group_id_a, group_id_b)
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
        with self._state_lock:
            src = self._source_dir
            dst = self._dest_dir
        if src is None or dst is None:
            return {"ok": False, "error": "Please select both source and destination folders."}

        try:
            self._cluster_manager.load()
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

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        run_folder = self._runs_dir / f"run_{timestamp}"
        suffix = 1
        while run_folder.exists():
            run_folder = self._runs_dir / f"run_{timestamp}_{suffix}"
            suffix += 1
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
                self._finish_job(
                    f"Undo completed: {summary.get('restored')} files restored.",
                    result=summary,
                )
            except Exception as err:
                self._finish_job("Undo failed", error=str(err))

        threading.Thread(target=worker, daemon=True).start()
        return {"ok": True, "started": True, "run_id": latest_log.parent.name}
