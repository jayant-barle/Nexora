"""Tests for People screen search, sort, and large group (needs_review) naming and placement."""

from __future__ import annotations

import json
from pathlib import Path
import tkinter as tk
import pytest

from nexora.faces.groups import FaceClusterManager
from nexora.faces.people import PeopleManager
from nexora.plan import build_plan
from nexora.ui import NexoraApp


def _create_test_cluster_manager(tmp_path: Path) -> tuple[FaceClusterManager, PeopleManager, list[Path]]:
    """Helper to create a FaceClusterManager and PeopleManager backed by tmp_path."""
    runs_dir = tmp_path / "runs"
    runs_dir.mkdir(parents=True, exist_ok=True)
    json_path = runs_dir / "faces.json"

    photos_dir = tmp_path / "photos"
    photos_dir.mkdir(parents=True, exist_ok=True)

    # Create dummy photo files
    files = []
    for i in range(70):
        p = photos_dir / f"photo_{i:03d}.jpg"
        p.write_bytes(f"dummy content {i}".encode())
        files.append(p)

    cm = FaceClusterManager(json_path=json_path)

    # 4 distinct groups:
    # group_001: Named "Alice", 10 faces, needs_review=False
    # group_002: Named "Bob", 25 faces, needs_review=True (large group)
    # group_003: Unnamed, 30 faces, needs_review=True (large group)
    # group_004: Unnamed, 5 faces, needs_review=False
    cm.groups = [
        {
            "id": "group_001",
            "name": "alice",
            "display_name": "Alice",
            "crop_path": "",
            "crop_paths": [],
            "representative_embedding": [0.1] * 128,
            "member_faces": [f"{str(files[i].resolve())}:0" for i in range(0, 10)],
            "needs_review": False,
        },
        {
            "id": "group_002",
            "name": "bob",
            "display_name": "Bob",
            "crop_path": "",
            "crop_paths": [],
            "representative_embedding": [0.2] * 128,
            "member_faces": [f"{str(files[i].resolve())}:0" for i in range(10, 35)],
            "needs_review": True,
        },
        {
            "id": "group_003",
            "name": None,
            "display_name": None,
            "crop_path": "",
            "crop_paths": [],
            "representative_embedding": [0.3] * 128,
            "member_faces": [f"{str(files[i].resolve())}:0" for i in range(35, 65)],
            "needs_review": True,
        },
        {
            "id": "group_004",
            "name": None,
            "display_name": None,
            "crop_path": "",
            "crop_paths": [],
            "representative_embedding": [0.4] * 128,
            "member_faces": [f"{str(files[i].resolve())}:0" for i in range(65, 70)],
            "needs_review": False,
        },
    ]

    file_groups: dict[str, list[str]] = {}
    for i in range(0, 10):
        file_groups[str(files[i].resolve())] = ["group_001"]
    for i in range(10, 35):
        file_groups[str(files[i].resolve())] = ["group_002"]
    for i in range(35, 65):
        file_groups[str(files[i].resolve())] = ["group_003"]
    for i in range(65, 70):
        file_groups[str(files[i].resolve())] = ["group_004"]

    cm.file_groups = file_groups
    cm.cache = {
        k: {
            "mtime": 1000.0,
            "size": 100,
            "sha256": f"sha_{idx}",
            "type": "image",
            "faces": [{"embedding": [0.1] * 128}],
        }
        for idx, k in enumerate(file_groups.keys())
    }
    cm.save()

    pm = PeopleManager(cm)
    return cm, pm, files


def test_people_search_filters(tmp_path: Path):
    """Test search box filters: name substring, 'unnamed', 'large group', 'needs review', and empty query."""
    cm, pm, _ = _create_test_cluster_manager(tmp_path)
    groups = pm.get_visible_groups()
    assert len(groups) == 4

    # 1. Empty search shows all groups
    assert len(pm.filter_groups(groups, "")) == 4
    assert len(pm.filter_groups(groups, "   ")) == 4

    # 2. Case-insensitive name substring
    alice_matches = pm.filter_groups(groups, "alice")
    assert [g["id"] for g in alice_matches] == ["group_001"]

    alice_upper = pm.filter_groups(groups, "ALICE")
    assert [g["id"] for g in alice_upper] == ["group_001"]

    bob_matches = pm.filter_groups(groups, "bob")
    assert [g["id"] for g in bob_matches] == ["group_002"]

    # 3. Search "unnamed"
    unnamed_matches = pm.filter_groups(groups, "unnamed")
    unnamed_ids = {g["id"] for g in unnamed_matches}
    assert unnamed_ids == {"group_003", "group_004"}

    # Search specific unnamed numbering
    # group_003 has 30 faces -> Unnamed person 1
    # group_004 has 5 faces -> Unnamed person 2
    u1_matches = pm.filter_groups(groups, "unnamed person 1")
    assert [g["id"] for g in u1_matches] == ["group_003"]

    u2_matches = pm.filter_groups(groups, "unnamed person 2")
    assert [g["id"] for g in u2_matches] == ["group_004"]

    # 4. Search "large group" / "needs review"
    # Matches both group_002 (Bob, needs_review=True) and group_003 (Unnamed 1, needs_review=True)
    large_matches = pm.filter_groups(groups, "large group")
    large_ids = {g["id"] for g in large_matches}
    assert large_ids == {"group_002", "group_003"}

    large_word_matches = pm.filter_groups(groups, "large")
    assert {g["id"] for g in large_word_matches} == {"group_002", "group_003"}

    needs_review_matches = pm.filter_groups(groups, "needs review")
    assert {g["id"] for g in needs_review_matches} == {"group_002", "group_003"}

    # 5. Single-character queries: match assigned names only, not keywords
    # Single letter "a" returns only groups whose name contains "a" (Alice), not all large groups or unnamed groups
    a_matches = pm.filter_groups(groups, "a")
    assert [g["id"] for g in a_matches] == ["group_001"]

    # Single letter "n" does not return all unnamed groups (returns empty since neither Alice nor Bob contains 'n')
    n_matches = pm.filter_groups(groups, "n")
    assert n_matches == []

    # Single letter "o" matches Bob, not unnamed or non-'o' groups
    o_matches = pm.filter_groups(groups, "o")
    assert [g["id"] for g in o_matches] == ["group_002"]

    # 6. Non-matching search shows empty list
    no_matches = pm.filter_groups(groups, "Charlie")
    assert no_matches == []


def test_people_sort_orders(tmp_path: Path):
    """Test all four sort dropdown options: Largest first, Smallest first, Name A-Z, Needs review first."""
    cm, pm, _ = _create_test_cluster_manager(tmp_path)
    groups = pm.get_visible_groups()
    assert len(groups) == 4

    # 1. "Largest first": group sizes are 30 (group_003), 25 (group_002), 10 (group_001), 5 (group_004)
    largest_sorted = pm.sort_groups(groups, "Largest first")
    assert [g["id"] for g in largest_sorted] == ["group_003", "group_002", "group_001", "group_004"]

    # 2. "Smallest first": 5 (group_004), 10 (group_001), 25 (group_002), 30 (group_003)
    smallest_sorted = pm.sort_groups(groups, "Smallest first")
    assert [g["id"] for g in smallest_sorted] == ["group_004", "group_001", "group_002", "group_003"]

    # 3. "Name A-Z":
    # Names: Alice (group_001), Bob (group_002), Unnamed person 1 (group_003), Unnamed person 2 (group_004)
    name_sorted = pm.sort_groups(groups, "Name A-Z")
    assert [g["id"] for g in name_sorted] == ["group_001", "group_002", "group_003", "group_004"]

    # 4. "Needs review first":
    # needs_review=True groups: group_003 (30 faces), group_002 (25 faces)
    # needs_review=False groups: group_001 (10 faces), group_004 (5 faces)
    nr_sorted = pm.sort_groups(groups, "Needs review first")
    assert [g["id"] for g in nr_sorted] == ["group_003", "group_002", "group_001", "group_004"]


def test_naming_needs_review_group_clears_flag_and_enables_placement(tmp_path: Path):
    """Naming a needs_review group clears the needs_review flag and makes it eligible for plan placement."""
    cm, pm, files = _create_test_cluster_manager(tmp_path)
    dest_dir = tmp_path / "dest"
    dest_dir.mkdir(parents=True, exist_ok=True)
    photos_dir = tmp_path / "photos"

    # group_003 is currently unnamed with 30 faces and needs_review=True
    group_003 = next(g for g in cm.groups if g["id"] == "group_003")
    assert group_003["needs_review"] is True
    assert group_003["name"] is None

    # Before naming: group_003 is withheld from placement (treated as HIDDEN)
    face_data_before = pm.get_face_data_for_plan()
    sample_file_key = str(files[35].resolve())
    assert face_data_before[sample_file_key]["faces"] == []

    # Also withheld report tracks all 30 photos
    report_before = pm.get_withheld_photos_report()
    nr_file_names = {item["file_name"] for item in report_before["needs_review"]}
    assert len(nr_file_names) == 30

    # Build plan before naming: photos in group_003 must NOT be placed into a person folder
    plan_before = build_plan(photos_dir, dest_dir, face_data=face_data_before)
    plan_before_map = {p.source.name: p.target for p in plan_before}
    # photo_035 has no date and no name rule match, so it lands in Unsorted
    assert plan_before_map["photo_035.jpg"].parent.name == "Unsorted"

    # Now name the group using the standard PeopleManager path
    saved_name = pm.name_group("group_003", "Charlie")
    assert saved_name == "Charlie"

    # Verify needs_review flag is cleared on in-memory group
    assert group_003["needs_review"] is False
    assert group_003["name"] == "charlie"
    assert group_003["display_name"] == "Charlie"

    # Verify changes were saved to disk in faces.json
    cm_disk = FaceClusterManager(json_path=cm.json_path)
    disk_g3 = next(g for g in cm_disk.groups if g["id"] == "group_003")
    assert disk_g3["needs_review"] is False
    assert disk_g3["display_name"] == "Charlie"
    assert disk_g3["name"] == "charlie"

    # After naming: get_face_data_for_plan() now places group_003 under "Charlie"
    face_data_after = pm.get_face_data_for_plan()
    assert face_data_after[sample_file_key]["faces"] == ["Charlie"]

    # Withheld report needs_review should now be 0 for Charlie's photos
    report_after = pm.get_withheld_photos_report()
    assert len(report_after["needs_review"]) == 0

    # Build plan after naming: photo_035 now lands in dest / "Charlie" / "photo_035.jpg"
    plan_after = build_plan(photos_dir, dest_dir, face_data=face_data_after)
    plan_after_map = {p.source.name: p.target for p in plan_after}
    assert plan_after_map["photo_035.jpg"] == dest_dir / "Charlie" / "photo_035.jpg"


def test_ui_search_and_sort_integration(tmp_path: Path):
    """UI integration test: verify search and sort widgets exist, filter cards, and show empty match label."""
    cm, pm, _ = _create_test_cluster_manager(tmp_path)

    try:
        root = tk.Tk()
    except Exception as e:
        pytest.skip(f"Tkinter unavailable: {e}")

    try:
        root.withdraw()
        app = NexoraApp(root)
        app.cluster_manager = cm
        app.people_manager = pm

        # Check search and sort controls exist
        assert hasattr(app, "people_search_entry"), "Search entry must exist"
        assert hasattr(app, "people_sort_dropdown"), "Sort dropdown must exist"
        assert hasattr(app, "people_search_var"), "Search StringVar must exist"
        assert hasattr(app, "people_sort_var"), "Sort StringVar must exist"

        # Initial render: all 4 groups
        app.render_people_cards()

        # Filter by search for Alice
        app.people_search_var.set("Alice")
        # Verify card rendered
        card_labels = [
            leaf.cget("text")
            for w in app.people_scroll_frame.winfo_children()
            if isinstance(w, tk.Frame)
            for sub in w.winfo_children()
            if isinstance(sub, tk.Frame)
            for leaf in sub.winfo_children()
            if isinstance(leaf, tk.Label)
        ]
        assert "Alice" in card_labels

        # Filter for non-existent person
        app.people_search_var.set("Nonexistent Person XYZ")
        empty_labels = [
            w.cget("text")
            for w in app.people_scroll_frame.winfo_children()
            if isinstance(w, tk.Label)
        ]
        assert any("No people match 'Nonexistent Person XYZ'." in txt for txt in empty_labels)

        # Clear search and test sort dropdown selection
        app.people_search_var.set("")
        app.people_sort_var.set("Smallest first")
        app.render_people_cards()

    finally:
        root.destroy()
