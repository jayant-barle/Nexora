"""Unit tests for nexora.undo undo_run."""

from pathlib import Path
import pytest

from nexora.plan import build_plan
from nexora.mover import run_plan, compute_sha256
from nexora.undo import find_latest_active_run_log, undo_run


def test_undo_restores_every_file_from_run(tmp_path: Path) -> None:
    src = tmp_path / "source"
    dst = tmp_path / "dest"
    src.mkdir()
    dst.mkdir()

    f1 = src / "nyc.jpg"
    f2 = src / "paris_sunset.mp4"
    f1.write_bytes(b"nyc photo data")
    f2.write_bytes(b"paris video data")

    sha1 = compute_sha256(f1)
    sha2 = compute_sha256(f2)

    log_path = tmp_path / "runs" / "run.log"
    plan = build_plan(src, dst)
    run_summary = run_plan(plan, log_path)
    assert run_summary["moved"] == 2
    assert not f1.exists()
    assert not f2.exists()

    # Perform undo
    undo_summary = undo_run(log_path)
    assert undo_summary["restored"] == 2
    assert undo_summary["skipped"] == 0
    assert undo_summary["missing"] == 0

    # Verify both restored back to exact original paths and hashes
    assert f1.exists()
    assert f2.exists()
    assert compute_sha256(f1) == sha1
    assert compute_sha256(f2) == sha2

    # Verify undone.json was written next to log
    undone_json = log_path.parent / "undone.json"
    assert undone_json.exists()


def test_undo_refuses_to_run_twice(tmp_path: Path) -> None:
    src = tmp_path / "source"
    dst = tmp_path / "dest"
    src.mkdir()
    dst.mkdir()

    (src / "nyc.jpg").write_text("photo", encoding="utf-8")
    log_path = tmp_path / "runs" / "run.log"
    plan = build_plan(src, dst)
    run_plan(plan, log_path)

    # First undo succeeds
    undo_run(log_path)

    # Second undo must be refused
    with pytest.raises(RuntimeError, match="undone.json exists"):
        undo_run(log_path)


def test_undo_skips_file_whose_original_path_is_now_taken(tmp_path: Path) -> None:
    src = tmp_path / "source"
    dst = tmp_path / "dest"
    src.mkdir()
    dst.mkdir()

    orig_file = src / "nyc.jpg"
    orig_file.write_text("original content", encoding="utf-8")

    log_path = tmp_path / "runs" / "run.log"
    plan = build_plan(src, dst)
    run_plan(plan, log_path)

    moved_target = dst / "nyc" / "nyc.jpg"
    assert moved_target.exists()
    assert not orig_file.exists()

    # Now create a new file in the original path before undo
    orig_file.write_text("interfering new file created after run", encoding="utf-8")

    undo_summary = undo_run(log_path)
    assert undo_summary["restored"] == 0
    assert undo_summary["skipped"] == 1

    # Neither file should be overwritten or deleted
    assert orig_file.read_text(encoding="utf-8") == "interfering new file created after run"
    assert moved_target.exists()
    assert moved_target.read_text(encoding="utf-8") == "original content"


def test_find_latest_active_run_log_skips_empty_logs(tmp_path: Path) -> None:
    runs = tmp_path / "runs"
    (runs / "face_crops" / "run.log").parent.mkdir(parents=True)
    (runs / "face_crops" / "run.log").write_text('{"x": 1}\n', encoding="utf-8")

    older = runs / "run_20260101_000001"
    older.mkdir(parents=True)
    (older / "run.log").write_text('{"original": "a", "moved_to": "b", "sha256": "0"}\n', encoding="utf-8")

    newer_empty = runs / "run_20260102_000001"
    newer_empty.mkdir(parents=True)
    (newer_empty / "run.log").write_text("", encoding="utf-8")

    found = find_latest_active_run_log(runs)
    assert found == older / "run.log"


def test_undo_stops_on_sha256_mismatch_without_writing_undone_json(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    src = tmp_path / "source"
    dst = tmp_path / "dest"
    src.mkdir()
    dst.mkdir()

    f1 = src / "first.jpg"
    f2 = src / "second.jpg"
    f1.write_bytes(b"first photo bytes")
    f2.write_bytes(b"second photo bytes")

    log_path = tmp_path / "runs" / "run.log"
    plan = build_plan(src, dst)
    run_plan(plan, log_path)

    monkeypatch.setattr("nexora.undo.compute_sha256", lambda _p: "corrupted_hash")
    summary = undo_run(log_path)

    assert summary["stopped"] is True
    assert "SHA-256 mismatch" in summary["reason"]
    assert summary["mismatched"] == 1
    assert summary["restored"] == 0
    assert not (log_path.parent / "undone.json").exists()


def test_undo_stops_on_oserror_without_writing_undone_json(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    src = tmp_path / "source"
    dst = tmp_path / "dest"
    src.mkdir()
    dst.mkdir()

    f1 = src / "only.jpg"
    f1.write_bytes(b"only photo bytes")

    log_path = tmp_path / "runs" / "run.log"
    plan = build_plan(src, dst)
    run_plan(plan, log_path)

    def broken_replace(_src: str, _dst: str) -> None:
        raise OSError("disk full")

    monkeypatch.setattr("nexora.undo.os.replace", broken_replace)
    summary = undo_run(log_path)

    assert summary["stopped"] is True
    assert "Cannot restore" in summary["reason"]
    assert summary["restored"] == 0
    assert not (log_path.parent / "undone.json").exists()
