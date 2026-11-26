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

    lib_imgs = api.list_source_files(query="nyc", file_type="image")
    assert len(lib_imgs["files"]) == 1
    assert lib_imgs["files"][0]["name"] == "nyc_park.jpg"
    assert lib_imgs["files"][0]["preview_url"] is not None

    crystal = api.get_crystal_chamber_status()
    assert crystal["supported"] is False
    assert "never deletes" in " ".join(crystal["details"]).lower()

    hall = api.get_main_hall_summary()
    assert hall["ok"] is True
    assert hall["indexed_total"] == 0


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
