"""Safety tests proving no delete functions are called during any operation."""

import os
from pathlib import Path
import shutil
import pytest

from nexora.plan import build_plan
from nexora.mover import run_plan
from nexora.undo import undo_run


def test_safety_no_delete_calls_during_plan_move_undo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    def forbidden_delete(*args, **kwargs):
        raise AssertionError("Safety violation: File or directory deletion is strictly prohibited by Nexora rules!")

    monkeypatch.setattr(os, "remove", forbidden_delete)
    monkeypatch.setattr(os, "unlink", forbidden_delete)
    monkeypatch.setattr(shutil, "rmtree", forbidden_delete)

    src = tmp_path / "source"
    dst = tmp_path / "dest"
    src.mkdir()
    dst.mkdir()

    f1 = src / "nyc.jpg"
    f2 = src / "IMG_2034.jpg"
    f3 = src / "notes.txt"
    f1.write_bytes(b"content 1")
    f2.write_bytes(b"content 2")
    f3.write_bytes(b"text content")

    log_path = tmp_path / "runs" / "run.log"

    # Step 1: Plan
    plan = build_plan(src, dst)

    # Step 2: Move
    summary = run_plan(plan, log_path)
    assert summary["moved"] == 2
    assert summary["skipped"] == 1
    assert summary["stopped"] is False

    # Step 3: Undo
    undo_summary = undo_run(log_path)
    assert undo_summary["restored"] == 2

    # All files restored
    assert f1.exists()
    assert f2.exists()
    assert f3.exists()
