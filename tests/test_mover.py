"""Unit tests for nexora.mover run_plan."""

from pathlib import Path
import pytest

from nexora.plan import build_plan
import nexora.plan
from nexora.mover import run_plan, compute_sha256
import nexora.mover


def test_moved_file_keeps_same_sha256(tmp_path: Path) -> None:
    src = tmp_path / "source"
    dst = tmp_path / "dest"
    src.mkdir()
    dst.mkdir()

    file_a = src / "nyc.jpg"
    content = b"Image bytes for NYC photo 12345"
    file_a.write_bytes(content)
    initial_sha = compute_sha256(file_a)

    log_path = tmp_path / "runs" / "run.log"
    plan = build_plan(src, dst)
    summary = run_plan(plan, log_path)

    assert summary["moved"] == 1
    assert summary["stopped"] is False
    assert not file_a.exists()  # Moved, not copied

    target_file = dst / "nyc" / "nyc.jpg"
    assert target_file.exists()
    assert compute_sha256(target_file) == initial_sha


def test_collision_never_overwrites(tmp_path: Path) -> None:
    src = tmp_path / "source"
    dst = tmp_path / "dest"
    src.mkdir()
    dst.mkdir()

    existing_target = dst / "nyc" / "nyc.jpg"
    existing_target.parent.mkdir(parents=True)
    existing_target.write_bytes(b"Original file already in destination")

    new_source = src / "nyc.jpg"
    new_source.write_bytes(b"Brand new file with same filename")

    log_path = tmp_path / "runs" / "run.log"
    plan = build_plan(src, dst)
    summary = run_plan(plan, log_path)

    assert summary["moved"] == 1

    # Original file is preserved exactly as it was
    assert existing_target.read_bytes() == b"Original file already in destination"

    # New file was moved to suffixed name
    suffixed_target = dst / "nyc" / "nyc (1).jpg"
    assert suffixed_target.exists()
    assert suffixed_target.read_bytes() == b"Brand new file with same filename"


def test_cross_drive_plan_entry_refused(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    src = tmp_path / "source"
    dst = tmp_path / "dest"
    src.mkdir()
    dst.mkdir()

    (src / "nyc.jpg").write_text("nyc photo", encoding="utf-8")

    # Simulate cross-drive check failure
    monkeypatch.setattr(nexora.plan, "is_same_drive", lambda p1, p2: False)

    plan = build_plan(src, dst)
    assert len(plan) == 1
    assert plan[0].status == "refused"

    log_path = tmp_path / "runs" / "run.log"
    summary = run_plan(plan, log_path)

    assert summary["refused"] == 1
    assert summary["moved"] == 0
    # Source file must not be touched
    assert (src / "nyc.jpg").exists()


def test_sha_mismatch_stops_run_immediately(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    src = tmp_path / "source"
    dst = tmp_path / "dest"
    src.mkdir()
    dst.mkdir()

    (src / "nyc.jpg").write_text("first photo", encoding="utf-8")
    (src / "paris.jpg").write_text("second photo", encoding="utf-8")

    # Monkeypatch compute_sha256 so that second call (post-move check) returns a wrong hash
    calls = 0
    real_compute = compute_sha256

    def corrupting_sha(path: Path | str) -> str:
        nonlocal calls
        calls += 1
        real_hash = real_compute(path)
        if calls == 2:  # Post-move check of first file
            return "corrupted_hash_mismatch"
        return real_hash

    monkeypatch.setattr(nexora.mover, "compute_sha256", corrupting_sha)

    log_path = tmp_path / "runs" / "run.log"
    plan = build_plan(src, dst)
    summary = run_plan(plan, log_path)

    assert summary["stopped"] is True
    assert "SHA-256 mismatch" in summary["reason"]

    # Second file must NOT have been moved because run halted
    assert (src / "paris.jpg").exists()
