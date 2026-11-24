"""Test OSError handling during run_plan in nexora.mover (AGENTS.md Rule 4)."""

import os
from pathlib import Path
import pytest

from nexora.mover import run_plan
import nexora.mover
from nexora.plan import build_plan
from nexora.undo import undo_run


def test_mover_oserror_stops_run_and_logs_completed_moves(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """When os.replace raises PermissionError on the second file:
    
    1. run_plan returns without raising an unhandled exception.
    2. summary has stopped=True and a reason naming the failed source file.
    3. The first move is logged in the run log so undo can reverse it.
    4. The third file is untouched.
    """
    src = tmp_path / "src"
    dst = tmp_path / "dst"
    runs = tmp_path / "runs"
    src.mkdir(parents=True)
    dst.mkdir(parents=True)
    runs.mkdir(parents=True)

    # 3 files to move
    f1 = src / "nyc_1.jpg"
    f2 = src / "nyc_2.jpg"
    f3 = src / "nyc_3.jpg"
    f1.write_text("photo 1", encoding="utf-8")
    f2.write_text("photo 2", encoding="utf-8")
    f3.write_text("photo 3", encoding="utf-8")

    plan = build_plan(src, dst)
    ready_moves = [m for m in plan if m.status == "ready"]
    assert len(ready_moves) == 3, f"Expected 3 ready moves, got {len(ready_moves)}"

    # Sort plan by filename so order is deterministic
    plan.sort(key=lambda m: str(m.source))

    # Monkeypatch os.replace in nexora.mover to fail on the second move
    real_replace = os.replace
    replace_count = 0

    def mock_replace(s, d):
        nonlocal replace_count
        replace_count += 1
        if replace_count == 2:
            raise PermissionError("Access is denied (locked by another process)")
        return real_replace(s, d)

    monkeypatch.setattr(nexora.mover.os, "replace", mock_replace)

    log_path = runs / "run.log"

    # Call run_plan: must return cleanly without raising
    summary = run_plan(plan, log_path)

    # Assert: summary has stopped=True and reason names the failed source file
    assert summary["stopped"] is True
    assert str(f2) in summary["reason"] or f2.name in summary["reason"]
    assert summary["moved"] == 1

    # Assert: first move is logged in the run log so undo can reverse it
    assert log_path.exists()
    assert not f1.exists(), "First file must have been moved"
    undo_summary = undo_run(log_path)
    assert undo_summary["restored"] == 1
    assert f1.exists(), "First file must be restored by undo"

    # Assert: third file is untouched
    assert f3.exists(), "Third file must be untouched"
