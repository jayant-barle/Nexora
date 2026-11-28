"""Unit tests for Nexora's Python-to-Web bridge API and security boundaries (Rule 4)."""

from __future__ import annotations

import ast
import inspect
import os
import time
from pathlib import Path

from PIL import Image
import pytest

import app as app_entry
from nexora.web.bridge import NexoraBridgeApi, SAFETY_FOOTER_TEXT


def _wait_job_done(api: NexoraBridgeApi, timeout: float = 10.0) -> dict:
    """Poll bridge background job state until completion."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        st = api.get_job_status()
        if not st["running"]:
            return st
        time.sleep(0.05)
    raise AssertionError("Bridge background job timed out")


def test_app_entry_keeps_freeze_support_and_classic_default() -> None:
    """Verify --web is opt-in, --classic works, and freeze_support stays first in __main__."""
    src = inspect.getsource(app_entry)
    tree = ast.parse(src)
    main_if = next(
        n for n in tree.body
        if isinstance(n, ast.If)
        and isinstance(n.test, ast.Compare)
        and getattr(n.test.left, "id", None) == "__name__"
    )
    first_stmt = main_if.body[0]
    assert isinstance(first_stmt, ast.Expr)
    assert isinstance(first_stmt.value, ast.Call)
    assert first_stmt.value.func.attr == "freeze_support"
    assert '"--web"' in src and '"--classic"' in src


def test_bridge_state_folder_picker_and_path_validation(tmp_path: Path) -> None:
    """Verify folder selection, validation, and initial state."""
    runs = tmp_path / "runs"
    src = tmp_path / "source"
    dst = tmp_path / "dest"
    src.mkdir()
    dst.mkdir()

    picked = iter([str(src), str(dst)])
    api = NexoraBridgeApi(runs_dir=runs, folder_picker=lambda role: next(picked))

    ping = api.ping()
    assert ping["ok"] is True
    assert ping["footer"] == SAFETY_FOOTER_TEXT

    # Empty/null-byte paths must be rejected
    bad_null = api.set_folders(source_dir=str(src) + "\x00bad")
    assert bad_null["ok"] is False

    missing = api.set_folders(source_dir=str(tmp_path / "does_not_exist"))
    assert missing["ok"] is False

    p_src = api.pick_folder("source")
    assert p_src["ok"] is True and p_src["cancelled"] is False
    p_dst = api.pick_folder("dest")
    assert p_dst["ok"] is True and p_dst["cancelled"] is False

    st = api.get_app_state()
    assert st["source_dir"] == str(src.resolve())
    assert st["dest_dir"] == str(dst.resolve())
    assert st["footer"] == SAFETY_FOOTER_TEXT


def test_bridge_media_allowlist_blocks_arbitrary_paths(tmp_path: Path) -> None:
    """Verify JS cannot preview files outside active source_dir or runs/face_crops/."""
    runs = tmp_path / "runs"
    crops = runs / "face_crops"
    crops.mkdir(parents=True)
    src = tmp_path / "source"
    sub = src / "nested"
    sub.mkdir(parents=True)
    outside = tmp_path / "secret.jpg"

    img_src = src / "nyc.jpg"
    img_nested = sub / "hidden.jpg"
    img_crop = crops / "crop_001.jpg"
    txt_src = src / "notes.txt"

    Image.new("RGB", (40, 40), color="green").save(img_src)
    Image.new("RGB", (40, 40), color="red").save(img_nested)
    Image.new("RGB", (40, 40), color="blue").save(img_crop)
    Image.new("RGB", (40, 40), color="yellow").save(outside)
    txt_src.write_text("sensitive", encoding="utf-8")

    api = NexoraBridgeApi(runs_dir=runs)
    api.set_folders(source_dir=str(src), dest_dir="")

    # Allowed: top-level source image and face crop
    assert api.is_allowed_media_path(img_src) is True
    assert api.is_allowed_media_path(img_crop) is True
    data_res = api.get_media_data_url(str(img_src))
    assert data_res["ok"] is True
    assert data_res["data_url"].startswith("data:image/jpeg;base64,")

    # Blocked: outside folder, nested subfolder, non-image text file, null byte
    assert api.is_allowed_media_path(outside) is False
    assert api.is_allowed_media_path(img_nested) is False
    assert api.is_allowed_media_path(txt_src) is False
    assert api.is_allowed_media_path(str(img_src) + "\x00") is False
    assert api.get_media_data_url(str(outside))["ok"] is False


def test_bridge_library_crystal_chamber_and_main_hall(tmp_path: Path) -> None:
    """Verify top-level Library listing, Main Hall metrics, and Crystal Chamber safety lock."""
    runs = tmp_path / "runs"
    src = tmp_path / "source"
    (src / "ignored_subfolder").mkdir(parents=True)
    Image.new("RGB", (20, 20), color="green").save(src / "nyc_park.jpg")
    (src / "clip.mp4").write_bytes(b"video bytes")
    (src / "readme.txt").write_bytes(b"notes")

    api = NexoraBridgeApi(runs_dir=runs)
    api.set_folders(source_dir=str(src), dest_dir="")

    lib_all = api.list_source_files()
    assert lib_all["has_source"] is True
    assert lib_all["total_top_level"] == 3
    assert lib_all["subfolders_skipped"] == 1
    assert lib_all["type_counts"] == {"all": 3, "image": 1, "video": 1, "other": 1}

    lib_imgs = api.list_source_files(query="nyc", file_type="image")
    assert len(lib_imgs["files"]) == 1
    assert lib_imgs["files"][0]["name"] == "nyc_park.jpg"
    assert lib_imgs["files"][0]["preview_url"] is not None

    # Inspect supported image with EXIF DateTimeOriginal, video, and unsupported file
    exif = Image.Exif()
    exif[36867] = "2024:06:15 11:22:33"
    exif_photo = src / "dated_trip.jpg"
    Image.new("RGB", (32, 24), color="blue").save(exif_photo, exif=exif)
    corrupt_img = src / "broken.jpg"
    corrupt_img.write_bytes(b"not a real jpeg")
    sub_img = src / "ignored_subfolder" / "hidden.jpg"
    Image.new("RGB", (10, 10), color="red").save(sub_img)

    insp_img = api.inspect_source_file(str(exif_photo))
    assert insp_img["ok"] is True
    assert insp_img["file"]["dimensions"] == "32 × 24 px"
    assert insp_img["file"]["exif_date"] == "2024-06-15 11:22:33"
    assert insp_img["file"]["exif_folder"] == "2024/2024-06/"
    assert insp_img["file"]["name_rule_candidate"] == "dated"
    assert insp_img["file"]["preview_url"] is not None

    insp_vid = api.inspect_source_file(str(src / "clip.mp4"))
    assert insp_vid["ok"] is True
    assert insp_vid["file"]["type"] == "video"
    assert insp_vid["file"]["exif_date"] is None
    assert insp_vid["file"]["preview_url"] is None

    insp_other = api.inspect_source_file(str(src / "readme.txt"))
    assert insp_other["ok"] is True
    assert insp_other["file"]["supported"] is False
    assert insp_other["file"]["preview_url"] is None
    assert "skipped" in insp_other["file"]["placement_summary"].lower()

    insp_corrupt = api.inspect_source_file(str(corrupt_img))
    assert insp_corrupt["ok"] is True
    assert insp_corrupt["file"]["preview_url"] is None
    assert insp_corrupt["file"]["image_error"] is not None

    # Security: inspection blocks subfolders and arbitrary outside paths
    assert api.inspect_source_file(str(sub_img))["ok"] is False
    outside = tmp_path / "outside.jpg"
    Image.new("RGB", (10, 10), color="white").save(outside)
    assert api.inspect_source_file(str(outside))["ok"] is False
    assert api.inspect_source_file("bad\x00path")["ok"] is False

    crystal = api.get_crystal_chamber_status()
    assert crystal["supported"] is False
    assert "never deletes" in " ".join(crystal["details"]).lower()

    hall = api.get_main_hall_summary()
    assert hall["ok"] is True
    assert hall["indexed_total"] == 0
    assert hall["unnamed_people"] == 0
    assert hall["people_preview"] == []

    # Legacy cache entries without explicit "type" should infer image vs video from suffix
    api._cluster_manager.cache["legacy_photo.jpg"] = {"size": 1200}
    api._cluster_manager.cache["legacy_clip.mp4"] = {"size": 4096}
    hall_legacy = api.get_main_hall_summary()
    assert hall_legacy["indexed_total"] == 2
    assert hall_legacy["indexed_images"] == 1
    assert hall_legacy["indexed_videos"] == 1
    assert hall_legacy["indexed_bytes"] == 5296


def test_bridge_preview_confirm_move_activity_and_undo(tmp_path: Path) -> None:
    """Verify Preview -> Approve confirmation guard -> Move -> Memory Room -> Undo."""
    runs = tmp_path / "runs"
    src = tmp_path / "source"
    dst = tmp_path / "dest"
    src.mkdir()
    dst.mkdir()

    photo = src / "nyc_trip.jpg"
    note = src / "notes.txt"
    photo.write_bytes(b"photo payload 123")
    note.write_bytes(b"text payload")

    api = NexoraBridgeApi(runs_dir=runs)
    api.set_folders(source_dir=str(src), dest_dir=str(dst))

    preview = api.build_preview()
    assert preview["ok"] is True
    assert preview["counts"]["ready"] == 1
    assert preview["counts"]["skipped"] == 1

    # Reject preview clears plan cleanly without moving
    api.reject_preview()
    assert api.get_preview_state()["counts"]["total"] == 0
    assert photo.exists()

    # Rebuild preview and test confirmation guard
    api.build_preview()
    unconfirmed = api.approve_move(confirmed=False)
    assert unconfirmed["ok"] is False
    assert photo.exists()

    # Confirmed move executes verified run_plan
    started = api.approve_move(confirmed=True)
    assert started["ok"] is True
    move_job = _wait_job_done(api)
    assert move_job["error"] is None
    assert move_job["last_result"]["moved"] == 1
    assert not photo.exists()
    assert (dst / "nyc" / "nyc_trip.jpg").exists()

    # Memory Room reflects the completed move run
    logs = api.list_activity_logs()["entries"]
    assert len(logs) == 1
    assert logs[0]["kind"] == "move_run"
    assert logs[0]["moved_count"] == 1
    assert logs[0]["undone"] is False

    # Undo requires confirmation and restores original file
    assert api.execute_undo(confirmed=False)["ok"] is False
    undo_start = api.execute_undo(confirmed=True)
    assert undo_start["ok"] is True
    undo_job = _wait_job_done(api)
    assert undo_job["last_result"]["restored"] == 1
    assert photo.exists()
    assert not (dst / "nyc" / "nyc_trip.jpg").exists()


def test_bridge_people_operations_and_merge_guard(tmp_path: Path) -> None:
    """Verify Photo Garden API: naming, validation, split, merge guard, dismiss, scan."""
    runs = tmp_path / "runs"
    runs.mkdir()
    cm_json = runs / "faces.json"

    import json

    emb_a = [1.0] + [0.0] * 127
    emb_b = [0.0, 1.0] + [0.0] * 126
    state = {
        "schema_version": 3,
        "cache": {
            str(tmp_path / "p1.jpg"): {"status": "ok", "type": "image", "size": 10, "faces": [{"embedding": emb_a}]},
            str(tmp_path / "p2.jpg"): {"status": "ok", "type": "image", "size": 10, "faces": [{"embedding": emb_a}]},
            str(tmp_path / "p3.jpg"): {"status": "ok", "type": "image", "size": 10, "faces": [{"embedding": emb_b}]},
            str(tmp_path / "p4.jpg"): {"status": "ok", "type": "image", "size": 10, "faces": [{"embedding": emb_b}]},
            str(tmp_path / "p5.jpg"): {"status": "ok", "type": "image", "size": 10, "faces": [{"embedding": emb_b}]},
            str(tmp_path / "p6.jpg"): {"status": "ok", "type": "image", "size": 10, "faces": [{"embedding": emb_b}]},
            str(tmp_path / "p7.jpg"): {"status": "ok", "type": "image", "size": 10, "faces": [{"embedding": emb_b}]},
        },
        "groups": [
            {"id": "group_001", "name": None, "display_name": None, "crop_paths": [], "representative_embedding": emb_a, "needs_review": False},
            {"id": "group_002", "name": None, "display_name": None, "crop_paths": [], "representative_embedding": emb_a, "needs_review": False},
        ],
        "file_groups": {
            str(tmp_path / "p1.jpg"): ["group_001"],
            str(tmp_path / "p2.jpg"): ["group_001"],
            str(tmp_path / "p3.jpg"): ["group_002"],
            str(tmp_path / "p4.jpg"): ["group_002"],
            str(tmp_path / "p5.jpg"): ["group_002"],
            str(tmp_path / "p6.jpg"): ["group_002"],
            str(tmp_path / "p7.jpg"): ["group_002"],
        },
        "face_names": {},
        "unreadable": [],
        "dismissed_merges": [],
    }
    cm_json.write_text(json.dumps(state), encoding="utf-8")

    api = NexoraBridgeApi(runs_dir=runs)
    pstate = api.get_people_state()
    assert pstate["total_visible"] == 2
    assert len(pstate["suggestions"]) == 1

    # Invalid reserved name rejected
    assert api.name_group("group_001", "con")["ok"] is False
    # Valid name accepted
    assert api.name_group("group_001", "Alice")["ok"] is True

    # Small cluster (2 faces) absorbing large cluster (5 faces) triggers guard confirmation
    unconfirmed_merge = api.merge_groups("group_001", "group_002", confirmed_override=False)
    assert unconfirmed_merge["ok"] is False
    assert unconfirmed_merge["needs_confirmation"] is True

    confirmed_merge = api.merge_groups("group_001", "group_002", confirmed_override=True)
    assert confirmed_merge["ok"] is True

    # Split back into 2 groups
    split_res = api.split_group("group_001")
    assert split_res["ok"] is True
    assert len(api.get_people_state()["cards"]) >= 1


def test_web_app_static_routes_and_media_token_security(tmp_path: Path) -> None:
    """Verify Bottle WSGI static routing and per-session token protection on /api/media."""
    import io
    import urllib.parse
    from nexora.web.app import create_web_app, get_static_dir

    runs = tmp_path / "runs"
    crops = runs / "face_crops"
    crops.mkdir(parents=True)
    crop = crops / "crop_001.jpg"
    Image.new("RGB", (48, 48), color="purple").save(crop)

    outside = tmp_path / "outside.jpg"
    Image.new("RGB", (48, 48), color="orange").save(outside)

    api = NexoraBridgeApi(runs_dir=runs)
    wsgi_app = create_web_app(api, static_dir=get_static_dir())

    def call_wsgi(path_info: str, query_string: str = "") -> tuple[str, list, bytes]:
        captured: dict = {}
        environ = {
            "REQUEST_METHOD": "GET",
            "PATH_INFO": path_info,
            "QUERY_STRING": query_string,
            "SERVER_NAME": "127.0.0.1",
            "SERVER_PORT": "8080",
            "wsgi.version": (1, 0),
            "wsgi.url_scheme": "http",
            "wsgi.input": io.BytesIO(b""),
            "wsgi.errors": io.StringIO(),
            "wsgi.multithread": False,
            "wsgi.multiprocess": False,
            "wsgi.run_once": False,
        }

        def start_response(status, headers, exc_info=None):
            captured["status"] = status
            captured["headers"] = dict(headers)

        body = b"".join(wsgi_app(environ, start_response))
        return captured["status"], list(captured["headers"].items()), body

    st_idx, _, idx_body = call_wsgi("/")
    assert st_idx.startswith("200")
    assert b"treehouse-canvas-mount" in idx_body

    st_svg, hdrs_svg, svg_body = call_wsgi("/static/assets/svg/forest-scene.svg")
    assert st_svg.startswith("200")
    assert any("image/svg+xml" in v for k, v in hdrs_svg if k.lower() == "content-type")
    import xml.etree.ElementTree as ET
    ET.fromstring(svg_body.decode("utf-8"))
    for room in (
        b"main-hall",
        b"library",
        b"photo-garden",
        b"potion-workshop",
        b"memory-room",
        b"secret-vault",
        b"crystal-chamber",
    ):
        assert room in svg_body

    st_css, hdrs_css, _ = call_wsgi("/static/css/tokens.css")
    assert st_css.startswith("200")
    assert any("text/css" in v for k, v in hdrs_css if k.lower() == "content-type")

    st_lib_svg, _, lib_svg_body = call_wsgi("/static/assets/svg/library-shelf.svg")
    assert st_lib_svg.startswith("200")
    ET.fromstring(lib_svg_body.decode("utf-8"))

    st_lib_js, _, lib_js_body = call_wsgi("/static/js/library.js")
    assert st_lib_js.startswith("200")
    assert b"NexoraLibrary" in lib_js_body

    # /api/media without token or wrong token -> 403
    q_crop = urllib.parse.urlencode({"path": str(crop), "token": "wrong-token"})
    st_bad, _, _ = call_wsgi("/api/media", q_crop)
    assert st_bad.startswith("403")

    # /api/media with valid token but outside path -> 403
    q_outside = urllib.parse.urlencode({"path": str(outside), "token": api.session_token})
    st_out, _, _ = call_wsgi("/api/media", q_outside)
    assert st_out.startswith("403")

    # /api/media with valid token + allowlisted crop -> 200 JPEG
    q_ok = urllib.parse.urlencode({"path": str(crop), "token": api.session_token})
    st_ok, hdrs_ok, jpg_body = call_wsgi("/api/media", q_ok)
    assert st_ok.startswith("200")
    assert any("image/jpeg" in v for k, v in hdrs_ok if k.lower() == "content-type")
    assert jpg_body.startswith(b"\xff\xd8")


def test_main_web_worker_process_guard() -> None:
    """Ensure spawned ProcessPoolExecutor workers cannot open a PyWebView window."""
    import multiprocessing
    from unittest.mock import patch
    from nexora.web.app import main_web

    orig_name = multiprocessing.current_process().name
    try:
        multiprocessing.current_process().name = "NexoraScanWorker-123"
        with patch("webview.create_window") as mock_win:
            main_web()
            assert mock_win.call_count == 0
    finally:
        multiprocessing.current_process().name = orig_name


def test_bridge_multiprocess_scan_and_stop(tmp_path: Path) -> None:
    """Verify real ProcessPoolExecutor scan works cleanly through NexoraBridgeApi."""
    runs = tmp_path / "runs"
    src = tmp_path / "photos"
    src.mkdir()
    for i in range(3):
        Image.new("RGB", (64, 64), color=(20 * i, 120, 80)).save(src / f"test_{i}.jpg")

    api = NexoraBridgeApi(runs_dir=runs)
    api.set_folders(source_dir=str(src), dest_dir="")
    res = api.start_scan()
    assert res["ok"] is True

    job = _wait_job_done(api, timeout=20.0)
    assert job["error"] is None
    assert job["last_result"]["images_scanned"] == 3
    assert api.get_main_hall_summary()["indexed_total"] == 3


def test_bridge_library_empty_and_large_collection(tmp_path: Path) -> None:
    """Verify Magical Library handles empty folders and 240+ file collections cleanly."""
    runs = tmp_path / "runs"
    empty_src = tmp_path / "empty_src"
    (empty_src / "nested_only").mkdir(parents=True)

    api = NexoraBridgeApi(runs_dir=runs)
    # Before selecting source
    no_src = api.list_source_files()
    assert no_src["has_source"] is False
    assert no_src["type_counts"] == {"all": 0, "image": 0, "video": 0, "other": 0}

    # Empty source (with skipped nested folder)
    assert api.set_folders(source_dir=str(empty_src), dest_dir="")["ok"] is True
    empty_res = api.list_source_files()
    assert empty_res["has_source"] is True
    assert empty_res["total_top_level"] == 0
    assert empty_res["subfolders_skipped"] == 1

    # Large collection of 240 files across images, videos, and unsupported types
    large_src = tmp_path / "large_src"
    large_src.mkdir()
    for i in range(150):
        (large_src / f"beach_{i:03d}.jpg").write_bytes(b"img")
    for i in range(50):
        (large_src / f"clip_{i:03d}.mp4").write_bytes(b"vid")
    for i in range(40):
        (large_src / f"note_{i:03d}.txt").write_bytes(b"txt")

    assert api.set_folders(source_dir=str(large_src), dest_dir="")["ok"] is True
    full_res = api.list_source_files()
    assert full_res["total_top_level"] == 240
    assert full_res["filtered_count"] == 240
    assert full_res["type_counts"] == {"all": 240, "image": 150, "video": 50, "other": 40}

    vid_res = api.list_source_files(query="clip_04", file_type="video")
    assert vid_res["filtered_count"] == 10
    assert all(it["type"] == "video" for it in vid_res["files"])

    other_res = api.list_source_files(file_type="other")
    assert other_res["filtered_count"] == 40
    assert all(it["preview_url"] is None for it in other_res["files"])
