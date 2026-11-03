"""Unit tests for nexora.undo undo_run."""

from pathlib import Path
import pytest

from nexora.plan import build_plan
from nexora.mover import run_plan, compute_sha256
from nexora.undo import undo_run


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
