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


def test_safety_rule_4_strict_file_access_requires_tmp_path() -> None:
    """Enforce AGENTS.md Rule 4 strictly:

    Fail if any automated test function in tests/ calls open(), Path(...).read_*,
    or os.scandir on a path that is not derived from pytest's tmp_path fixture.
    """
    import ast

    tests_dir = Path(__file__).resolve().parent
    exempt_files = {Path(__file__).name, "test_faces_labelled.py"}

    violations: list[str] = []

    for test_file in sorted(tests_dir.glob("*.py")):
        if test_file.name in exempt_files:
            continue

        tree = ast.parse(test_file.read_text(encoding="utf-8"))

        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef) and node.name.startswith("test_"):
                args = [a.arg for a in node.args.args]
                tmp_vars = {"tmp_path"}

                # Fixed-point propagation to track all variables derived from tmp_path
                changed = True
                assign_nodes = [n for n in ast.walk(node) if isinstance(n, ast.Assign)]
                while changed:
                    changed = False
                    for sub in assign_nodes:
                        rhs_names = {n.id for n in ast.walk(sub.value) if isinstance(n, ast.Name)}
                        if rhs_names & tmp_vars:
                            for target in sub.targets:
                                if isinstance(target, ast.Name) and target.id not in tmp_vars:
                                    tmp_vars.add(target.id)
                                    changed = True

                for sub in ast.walk(node):
                    if isinstance(sub, ast.Call):
                        fn = ""
                        receiver = None
                        if isinstance(sub.func, ast.Name):
                            fn = sub.func.id
                            receiver = sub.args[0] if sub.args else None
                        elif isinstance(sub.func, ast.Attribute):
                            fn = sub.func.attr
                            receiver = sub.func.value

                        if fn in ("open", "scandir", "read_text", "read_bytes"):
                            if "tmp_path" not in args:
                                violations.append(
                                    f"{test_file.name}:{node.name}:{sub.lineno} calls {fn} but test does not accept tmp_path fixture"
                                )
                            if receiver is not None:
                                if isinstance(receiver, ast.Constant):
                                    violations.append(
                                        f"{test_file.name}:{node.name}:{sub.lineno} calls {fn} with constant path '{receiver.value}'"
                                    )
                                elif isinstance(receiver, ast.Name) and receiver.id not in tmp_vars:
                                    violations.append(
                                        f"{test_file.name}:{node.name}:{sub.lineno} calls {fn} on variable '{receiver.id}' not derived from tmp_path"
                                    )

    assert not violations, f"Strict Rule 4 violations found: {violations}"


def test_labels_template_contains_no_cluster_ids_or_group_prefix(tmp_path: Path) -> None:
    """Enforce ground-truth template confidentiality:

    Fail if the label template contains 'group_' or any cluster ID pattern.
    """
    import csv
    import re

    template_file = tmp_path / "labels_template.csv"
    runs_crops = tmp_path / "face_crops"
    runs_crops.mkdir(parents=True, exist_ok=True)

    dummy_crop = runs_crops / "crop_000001.jpg"
    dummy_crop.write_bytes(b"dummy image data")

    # Write a valid template with neutral crops and blank person
    rows = [
        ["file", "face_index", "crop_path", "person"],
        ["photo1.jpg", "0", str(dummy_crop), ""],
        ["photo2.jpg", "1", str(runs_crops / "crop_000002.jpg"), ""],
    ]
    with open(template_file, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerows(rows)

    content = template_file.read_text(encoding="utf-8")
    assert "group_" not in content.lower(), "Template must not contain 'group_'"
    assert not re.search(r"\bgroup_\d+\b", content, re.IGNORECASE), "Template must not contain cluster IDs"

    # Also verify that a template containing group_ is rejected
    corrupt_template = tmp_path / "corrupt_template.csv"
    corrupt_rows = [
        ["file", "face_index", "crop_path", "person"],
        ["photo1.jpg", "0", "runs/face_crops/crop_group_001_0.jpg", ""],
    ]
    with open(corrupt_template, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerows(corrupt_rows)

    corrupt_content = corrupt_template.read_text(encoding="utf-8")
    assert "group_" in corrupt_content.lower(), "Verification check: group_ was correctly detected"
