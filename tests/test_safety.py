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


def test_safety_rule_4_automated_tests_do_not_read_real_photo_folders() -> None:
    """Enforce AGENTS.md Rule 4: No automated test under tests/ may read a real photo folder or external path."""
    tests_dir = Path(__file__).resolve().parent
    # Build search terms dynamically so definition line itself is not matched literally
    p1 = "F" + ":\\"
    p2 = "F" + ":/"
    p3 = "chul" + "mati"
    p4 = "local " + "send files"
    forbidden_patterns = [p1, p2, p3, p4]

    violations: list[str] = []
    this_file = Path(__file__).name
    for test_file in tests_dir.glob("*.py"):
        content = test_file.read_text(encoding="utf-8")
        in_definition_func = False
        for line_num, line in enumerate(content.splitlines(), start=1):
            if test_file.name == this_file:
                if "def test_safety_rule_4" in line:
                    in_definition_func = True
                elif in_definition_func and line.startswith("def "):
                    in_definition_func = False
                if in_definition_func:
                    continue

            for pat in forbidden_patterns:
                if pat.lower() in line.lower():
                    violations.append(f"{test_file.name}:{line_num}: forbidden pattern '{pat}' -> {line.strip()}")

    assert not violations, f"Rule 4 violations found in tests/: {violations}"
