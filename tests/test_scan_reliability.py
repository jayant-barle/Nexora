"""Tests for scan reliability: versioned progress, per-scan logging, and unreadable files."""

import json
import threading
import tkinter as tk
from pathlib import Path
from unittest.mock import patch
import numpy as np
from PIL import Image

from nexora.faces.groups import FaceClusterManager
from nexora.ui import NexoraApp


def _make_dummy_image(path: Path, size: tuple[int, int] = (64, 64), color: tuple[int, int, int] = (120, 120, 120)) -> None:
    img = Image.new("RGB", size, color=color)
    img.save(path)


def test_migration_from_schema_1_keeps_cached_entries_and_names(tmp_path: Path):
    """Schema 1 file (without schema_version) is migrated in place to schema 2 preserving cache and names."""
    json_path = tmp_path / "runs" / "faces.json"
    json_path.parent.mkdir(parents=True)

    file_key = str((tmp_path / "photo.jpg").resolve())
    schema_1_data = {
        "version": 1,
        "cache": {
            file_key: {
                "size": 1024,
                "sha256": "abc123sha",
                "type": "image",
                "status": "ok",
                "faces": [{"box": [10, 10, 50, 50], "score": 0.95, "embedding": [0.1] * 128}],
            }
        },
        "groups": [{"id": "group_001", "name": "alice", "display_name": "Alice"}],
        "file_groups": {file_key: ["group_001"]},
        "face_names": {f"{file_key}:0": "Alice"},
    }

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(schema_1_data, f, indent=2)

    cm = FaceClusterManager(json_path=json_path)

    # In memory state
    assert file_key in cm.cache
    assert cm.face_names[f"{file_key}:0"] == "Alice"
    assert cm.groups[0]["name"] == "alice"
    assert cm.unreadable == set()

    # Disk state after in-place migration
    with open(json_path, "r", encoding="utf-8") as f:
        migrated = json.load(f)

    assert migrated.get("schema_version") == 2
    assert file_key in migrated["cache"]
    assert migrated["face_names"][f"{file_key}:0"] == "Alice"
    assert migrated["groups"][0]["name"] == "alice"
    assert "unreadable" in migrated


def test_corrupt_faces_json_moved_aside_and_starts_clean(tmp_path: Path):
    """A corrupt faces.json is moved to faces.corrupt-<timestamp>.json and the manager starts clean."""
    runs_dir = tmp_path / "runs"
    runs_dir.mkdir(parents=True)
    json_path = runs_dir / "faces.json"

    # Write corrupt JSON content
    json_path.write_text("{ corrupt json: [incomplete data...", encoding="utf-8")

    cm = FaceClusterManager(json_path=json_path)

    # faces.json was moved aside
    assert not json_path.exists()
    assert cm.corrupt_backup_path is not None
    assert cm.corrupt_backup_path.exists()
    assert "faces.corrupt-" in cm.corrupt_backup_path.name

    # State is completely clean
    assert cm.cache == {}
    assert cm.groups == []
    assert cm.file_groups == {}
    assert cm.face_names == {}
    assert cm.unreadable == set()

    # Next save creates clean schema_version 2 file
    cm.save()
    assert json_path.exists()
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    assert data.get("schema_version") == 2


def test_forced_stop_mid_scan_restart_rescans_nothing_cached(tmp_path: Path):
    """A forced stop mid-scan saves progress; restart rescans nothing already cached."""
    src = tmp_path / "source"
    src.mkdir()
    runs_dir = tmp_path / "runs"
    runs_dir.mkdir()
    json_path = runs_dir / "faces.json"

    for i in range(10):
        _make_dummy_image(src / f"img_{i:02d}.jpg")

    stop_event = threading.Event()
    cm1 = FaceClusterManager(json_path=json_path)

    count = 0
    def mock_process_image_1(p: Path, sz: int, sha: str) -> list[dict]:
        nonlocal count
        count += 1
        if count >= 4:
            stop_event.set()
        return [{"box": [10, 10, 50, 50], "score": 0.9, "embedding": [1.0] * 128}]

    with patch.object(cm1, "_process_image", side_effect=mock_process_image_1):
        cm1.scan_source(src, stop_event=stop_event, max_workers=1)

    assert json_path.exists()
    assert len(cm1.cache) == 4, f"Expected 4 cached items, got {len(cm1.cache)}"

    # Second scan with new manager instance
    cm2 = FaceClusterManager(json_path=json_path)
    assert len(cm2.cache) == 4

    rescanned_files: list[Path] = []
    def mock_process_image_2(p: Path, sz: int, sha: str) -> list[dict]:
        rescanned_files.append(p)
        return [{"box": [10, 10, 50, 50], "score": 0.9, "embedding": [1.0] * 128}]

    with patch.object(cm2, "_process_image", side_effect=mock_process_image_2):
        res = cm2.scan_source(src, max_workers=1)

    # 4 were cached and skipped; exactly 6 were scanned
    assert len(rescanned_files) == 6, f"Expected 6 files scanned, got {len(rescanned_files)}"
    assert len(cm2.cache) == 10
    assert res["images_scanned"] == 10


def test_scan_log_file_one_line_per_file_and_summary_line(tmp_path: Path):
    """The log file has one line per file and the summary line."""
    src = tmp_path / "src"
    src.mkdir()
    runs_dir = tmp_path / "runs"
    runs_dir.mkdir()
    json_path = runs_dir / "faces.json"

    # File 1: will have 1 face
    _make_dummy_image(src / "has_face.jpg")
    # File 2: will have 0 faces
    _make_dummy_image(src / "no_face.jpg")
    # File 3: unreadable corrupt file
    (src / "broken.jpg").write_bytes(b"not a valid image or video")

    cm = FaceClusterManager(json_path=json_path)

    orig_process_image = FaceClusterManager._process_image

    def mock_process_image(p: Path, sz: int, sha: str) -> list[dict]:
        if p.name == "has_face.jpg":
            return [{"box": [10, 10, 50, 50], "score": 0.9, "embedding": [1.0] * 128}]
        if p.name == "no_face.jpg":
            return []
        # For broken.jpg, call original implementation which detects unreadable bytes
        return orig_process_image(cm, p, sz, sha)

    with patch.object(cm, "_process_image", side_effect=mock_process_image):
        res = cm.scan_source(src, max_workers=1)

    log_path = Path(res["log_path"])
    assert log_path.exists(), "Scan log file must exist"

    lines = [line.strip() for line in log_path.read_text(encoding="utf-8").splitlines() if line.strip()]

    # 3 candidate files -> exactly 3 file lines + 1 summary line = 4 lines
    assert len(lines) == 4, f"Expected 4 lines (3 file lines + 1 summary line), got {len(lines)}: {lines}"

    # Check file lines
    file_lines = lines[:-1]
    statuses = [l.split(",")[0].strip() for l in file_lines]
    file_names = [l.split(",")[1].strip() for l in file_lines]

    assert "broken.jpg" in file_names
    assert "has_face.jpg" in file_names
    assert "no_face.jpg" in file_names

    broken_idx = file_names.index("broken.jpg")
    assert statuses[broken_idx] == "could-not-read"

    has_face_idx = file_names.index("has_face.jpg")
    assert statuses[has_face_idx] == "ok"

    no_face_idx = file_names.index("no_face.jpg")
    assert statuses[no_face_idx] == "no-faces"

    # Check summary line
    summary_line = lines[-1]
    assert summary_line.startswith("Summary:"), f"Summary line must start with Summary:, got {summary_line}"
    for required_token in ["total files", "ok", "cached", "could-not-read", "no-faces", "errors", "elapsed seconds"]:
        assert required_token in summary_line, f"Missing token '{required_token}' in summary: {summary_line}"


def test_unreadable_file_tracked_and_cleared_when_fixed(tmp_path: Path):
    """An unreadable file appears in 'unreadable' and clears once it is fixed."""
    src = tmp_path / "src"
    src.mkdir()
    runs_dir = tmp_path / "runs"
    runs_dir.mkdir()
    json_path = runs_dir / "faces.json"

    broken_file = src / "bad_image.jpg"
    broken_file.write_bytes(b"corrupt garbage content")

    cm = FaceClusterManager(json_path=json_path)
    cm.scan_source(src, max_workers=1)

    broken_key = str(broken_file.resolve())
    assert broken_key in cm.unreadable, f"Expected {broken_key} in unreadable set"

    # Verify unreadable written to faces.json
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    assert broken_key in data.get("unreadable", [])

    # Now fix the file by writing a valid image
    _make_dummy_image(broken_file)

    # Rescan
    cm2 = FaceClusterManager(json_path=json_path)
    assert broken_key in cm2.unreadable

    cm2.scan_source(src, max_workers=1)

    # Must be cleared from unreadable
    assert broken_key not in cm2.unreadable, f"Expected {broken_key} to be cleared from unreadable"

    # Verify faces.json has cleared it
    with open(json_path, "r", encoding="utf-8") as f:
        data2 = json.load(f)
    assert broken_key not in data2.get("unreadable", [])


def test_ui_unreadable_button_and_corrupt_status(tmp_path: Path):
    """UI has 'Unreadable files (N)' button, opens dialog, and displays corrupt status."""
    try:
        root = tk.Tk()
    except Exception as e:
        import pytest
        pytest.skip(f"Tkinter unavailable: {e}")

    try:
        root.withdraw()
        runs_dir = tmp_path / "runs"
        runs_dir.mkdir(parents=True)
        json_path = runs_dir / "faces.json"
        json_path.write_text("{corrupt json", encoding="utf-8")

        with patch("nexora.faces.groups.get_runs_dir", return_value=runs_dir):
            app = NexoraApp(root)

            # Button exists
            assert hasattr(app, "unreadable_btn"), "unreadable_btn must exist on app"
            assert "Unreadable files" in app.unreadable_btn.cget("text")

            # Corrupt status message in status bar
            assert "Corrupt faces.json moved to" in app.status_var.get()

            # Dialog opens without exception
            app._show_unreadable_files_window()
    finally:
        root.destroy()
