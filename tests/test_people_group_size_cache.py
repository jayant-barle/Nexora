"""Test caching of group sizes in PeopleManager to avoid repeated full scans of file_groups."""

import tkinter as tk
from pathlib import Path
import pytest

from nexora.faces.people import PeopleManager
from nexora.faces.groups import FaceClusterManager
from nexora.ui import NexoraApp


class CountingDict(dict):
    """Dictionary that counts how many times .values() is called."""

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self.values_calls = 0

    def values(self):
        self.values_calls += 1
        return super().values()


def test_sort_groups_scans_file_groups_at_most_once(tmp_path: Path) -> None:
    # Rule 4: tmp_path only
    runs_dir = tmp_path / "runs"
    runs_dir.mkdir(parents=True, exist_ok=True)

    cm = FaceClusterManager(json_path=runs_dir / "faces.json")

    # Build synthetic file_groups with 2000 files and 20 groups
    groups = [
        {"id": f"group_{i:03d}", "name": None, "display_name": None}
        for i in range(1, 21)
    ]
    raw_file_groups = {
        f"file_{i:04d}.jpg": [f"group_{(i % 20) + 1:03d}"]
        for i in range(2000)
    }

    counting_file_groups = CountingDict(raw_file_groups)
    cm.groups = groups
    cm.file_groups = counting_file_groups

    pm = PeopleManager(cm)

    # Call sort_groups on all 20 groups
    pm.sort_groups(groups)

    # Assert the number of full scans of file_groups is at most 1 (currently it is 20 or more)
    assert counting_file_groups.values_calls <= 1, (
        f"Expected at most 1 full scan of file_groups, but got {counting_file_groups.values_calls}"
    )


def test_filter_groups_scans_file_groups_at_most_once(tmp_path: Path) -> None:
    # Rule 4: tmp_path only
    runs_dir = tmp_path / "runs"
    runs_dir.mkdir(parents=True, exist_ok=True)

    cm = FaceClusterManager(json_path=runs_dir / "faces.json")

    groups = [
        {"id": f"group_{i:03d}", "name": None, "display_name": None}
        for i in range(1, 21)
    ]
    raw_file_groups = {
        f"file_{i:04d}.jpg": [f"group_{(i % 20) + 1:03d}"]
        for i in range(2000)
    }

    counting_file_groups = CountingDict(raw_file_groups)
    cm.groups = groups
    cm.file_groups = counting_file_groups

    pm = PeopleManager(cm)

    # Call filter_groups
    pm.filter_groups(groups, "unnamed")

    assert counting_file_groups.values_calls <= 1, (
        f"Expected at most 1 full scan of file_groups, but got {counting_file_groups.values_calls}"
    )


def test_render_people_cards_scans_file_groups_at_most_once(tmp_path: Path) -> None:
    # Rule 4: tmp_path only
    runs_dir = tmp_path / "runs"
    runs_dir.mkdir(parents=True, exist_ok=True)

    cm = FaceClusterManager(json_path=runs_dir / "faces.json")
    cm.save()

    groups = [
        {"id": f"group_{i:03d}", "name": None, "display_name": None}
        for i in range(1, 21)
    ]
    raw_file_groups = {
        f"file_{i:04d}.jpg": [f"group_{(i % 20) + 1:03d}"]
        for i in range(2000)
    }

    counting_file_groups = CountingDict(raw_file_groups)
    cm.groups = groups
    cm.file_groups = counting_file_groups

    pm = PeopleManager(cm)

    try:
        root = tk.Tk()
    except Exception as e:
        pytest.skip(f"Tkinter unavailable: {e}")

    try:
        root.withdraw()
        app = NexoraApp(root)
        app.cluster_manager = cm
        app.people_manager = pm

        counting_file_groups.values_calls = 0
        app.render_people_cards()

        # Render should compute group_sizes once and pass through
        assert counting_file_groups.values_calls <= 1, (
            f"Expected at most 1 full scan of file_groups during render, got {counting_file_groups.values_calls}"
        )
    finally:
        root.destroy()
