"""Test collision counter performance in resolve_collision."""

from __future__ import annotations

from pathlib import Path
import pytest

from nexora.plan import build_plan


def test_collision_counter_below_3x(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    src = tmp_path / "source"
    dst = tmp_path / "dest"
    src.mkdir()
    dst.mkdir()

    # Create 300 target files named IMG_0001.jpg (with collision suffixes) in one folder
    target_dir = dst / "Unsorted"
    target_dir.mkdir(parents=True)
    (target_dir / "IMG_0001.jpg").write_text("target_0", encoding="utf-8")
    for i in range(1, 300):
        (target_dir / f"IMG_0001 ({i}).jpg").write_text(f"target_{i}", encoding="utf-8")

    # Plus 300 sources with the same name
    source_file = src / "IMG_0001.jpg"
    source_file.write_text("source_content", encoding="utf-8")

    original_iterdir = Path.iterdir

    def mock_iterdir(self):
        if self.resolve() == src.resolve():
            return iter([source_file] * 300)
        return original_iterdir(self)

    monkeypatch.setattr(Path, "iterdir", mock_iterdir)

    exists_calls = 0
    original_exists = Path.exists

    def counting_exists(self):
        nonlocal exists_calls
        exists_calls += 1
        return original_exists(self)

    monkeypatch.setattr(Path, "exists", counting_exists)

    plan = build_plan(src, dst)
    assert len(plan) == 300

    # Assert the count is below 3 times the number of files
    assert exists_calls < 3 * 300, f"Path.exists was called {exists_calls} times (expected < {3 * 300})"
