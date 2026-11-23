"""Tests for People screen usability: large-group naming, search, sort, and immutability."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch
import tkinter as tk

import pytest

from nexora.faces.groups import FaceClusterManager
from nexora.faces.people import PeopleManager
from nexora.ui import NexoraApp


def _create_test_manager(runs_dir: Path) -> tuple[FaceClusterManager, PeopleManager]:
    """Helper to initialize FaceClusterManager and PeopleManager rooted in tmp_path."""
    runs_dir.mkdir(parents=True, exist_ok=True)
    faces_json = runs_dir / "faces.json"
    if not faces_json.exists():
        faces_json.write_text("{}", encoding="utf-8")
    with patch("nexora.faces.groups.get_runs_dir", return_value=runs_dir):
        cm = FaceClusterManager()
        cm.load()
        pm = PeopleManager(cm)
        return cm, pm


def test_naming_clears_needs_review_and_activates_placement(tmp_path: Path):
    """Test that naming a group flagged needs_review clears the flag and activates plan placement."""
    runs_dir = tmp_path / "runs"
    cm, pm = _create_test_manager(runs_dir)

    # Setup a large cluster exceeding review cap with needs_review=True
    cm.groups = [
        {
            "id": "group_001",
            "name": None,
            "display_name": None,
            "crop_paths": [],
            "representative_embedding": [1.0] + [0.0] * 127,
            "needs_review": True,
            "member_faces": [f"img_{i:03d}.jpg:0" for i in range(25)],
        }
    ]
    cm.file_groups = {f"img_{i:03d}.jpg": ["group_001"] for i in range(25)}
    cm.save()

    # Before naming: needs_review is True, face_data_for_plan withholds faces ("HIDDEN")
    assert cm.groups[0]["needs_review"] is True
    face_data_before = pm.get_face_data_for_plan()
    assert face_data_before["img_000.jpg"]["faces"] == []

    # Withheld report lists this group under needs_review
    withheld_before = pm.get_withheld_photos_report()
    assert len(withheld_before["needs_review"]) == 25

    # Name the group via set_group_name
    clean = pm.set_group_name("group_001", "Alice Smith")
    assert clean == "Alice Smith"

    # After naming: needs_review is False, display_name is set, folder name is lowercase
    assert cm.groups[0]["needs_review"] is False
    assert cm.groups[0]["display_name"] == "Alice Smith"
    assert cm.groups[0]["name"] == "alice smith"

    # Plan face data is now active: returns Alice Smith
    face_data_after = pm.get_face_data_for_plan()
    assert face_data_after["img_000.jpg"]["faces"] == ["Alice Smith"]

    # Withheld report no longer contains this group under needs_review
    withheld_after = pm.get_withheld_photos_report()
    assert len(withheld_after["needs_review"]) == 0


def test_search_filter_and_empty_message(tmp_path: Path):
    """Test search filter by display name, case-insensitivity, 'unnamed person N', and empty message."""
    runs_dir = tmp_path / "runs"
    cm, pm = _create_test_manager(runs_dir)

    cm.groups = [
        {
            "id": "group_001",
            "name": "alice",
            "display_name": "Alice Wonderland",
            "crop_paths": [],
            "representative_embedding": [1.0] + [0.0] * 127,
            "member_faces": ["f1.jpg:0", "f2.jpg:0"],
        },
        {
            "id": "group_002",
            "name": None,
            "display_name": None,
            "crop_paths": [],
            "representative_embedding": [0.0, 1.0] + [0.0] * 126,
            "member_faces": [f"u1_{i}.jpg:0" for i in range(10)],
        },
        {
            "id": "group_003",
            "name": None,
            "display_name": None,
            "crop_paths": [],
            "representative_embedding": [0.0, 0.0, 1.0] + [0.0] * 125,
            "member_faces": [f"u2_{i}.jpg:0" for i in range(4)],
        },
        {
            "id": "group_004",
            "name": "bob",
            "display_name": "Bob Builder",
            "crop_paths": [],
            "representative_embedding": [0.0, 0.0, 0.0, 1.0] + [0.0] * 124,
            "member_faces": ["b1.jpg:0", "b2.jpg:0", "b3.jpg:0"],
        },
    ]
    cm.file_groups = {
        "f1.jpg": ["group_001"],
        "f2.jpg": ["group_001"],
        "b1.jpg": ["group_004"],
        "b2.jpg": ["group_004"],
        "b3.jpg": ["group_004"],
    }
    for i in range(10):
        cm.file_groups[f"u1_{i}.jpg"] = ["group_002"]
    for i in range(4):
        cm.file_groups[f"u2_{i}.jpg"] = ["group_003"]
    cm.save()

    # Numbering: group_002 (10 faces) -> Unnamed person 1, group_003 (4 faces) -> Unnamed person 2
    numbering = pm.get_unnamed_numbering()
    assert numbering["group_002"] == "Unnamed person 1"
    assert numbering["group_003"] == "Unnamed person 2"

    visible = pm.get_visible_groups()
    assert len(visible) == 4

    # 1. Empty and whitespace queries show all groups
    assert len(pm.filter_and_sort_groups(visible, search_query="")) == 4
    assert len(pm.filter_and_sort_groups(visible, search_query="   ")) == 4

    # 2. Case-insensitive substring match for named person
    res_alice = pm.filter_and_sort_groups(visible, search_query="alice")
    assert [g["id"] for g in res_alice] == ["group_001"]

    res_upper = pm.filter_and_sort_groups(visible, search_query="WONDERLAND")
    assert [g["id"] for g in res_upper] == ["group_001"]

    # 3. Unnamed groups match "unnamed person N"
    res_p1 = pm.filter_and_sort_groups(visible, search_query="unnamed person 1")
    assert [g["id"] for g in res_p1] == ["group_002"]

    res_p2 = pm.filter_and_sort_groups(visible, search_query="person 2")
    assert [g["id"] for g in res_p2] == ["group_003"]

    res_unnamed = pm.filter_and_sort_groups(visible, search_query="unnamed")
    assert set(g["id"] for g in res_unnamed) == {"group_002", "group_003"}

    # 4. Search with no match returns empty list
    res_none = pm.filter_and_sort_groups(visible, search_query="Zachary")
    assert res_none == []


def test_all_three_sort_options(tmp_path: Path):
    """Test 'Most photos' (default), 'Fewest photos', and 'Name A–Z' sorting rules."""
    runs_dir = tmp_path / "runs"
    cm, pm = _create_test_manager(runs_dir)

    # Setup groups:
    # group_001: named "Zara", 10 faces across 2 files
    # group_002: named "Alice", 4 faces across 6 files
    # group_003: unnamed (Unnamed person 1), 20 faces across 5 files
    # group_004: unnamed (Unnamed person 2), 2 faces across 1 file
    cm.groups = [
        {
            "id": "group_001",
            "name": "zara",
            "display_name": "Zara",
            "crop_paths": [],
            "representative_embedding": [1.0] + [0.0] * 127,
            "member_faces": [f"z_{i}.jpg:0" for i in range(10)],
        },
        {
            "id": "group_002",
            "name": "alice",
            "display_name": "Alice",
            "crop_paths": [],
            "representative_embedding": [0.0, 1.0] + [0.0] * 126,
            "member_faces": [f"a_{i}.jpg:0" for i in range(4)],
        },
        {
            "id": "group_003",
            "name": None,
            "display_name": None,
            "crop_paths": [],
            "representative_embedding": [0.0, 0.0, 1.0] + [0.0] * 125,
            "member_faces": [f"u1_{i}.jpg:0" for i in range(20)],
        },
        {
            "id": "group_004",
            "name": None,
            "display_name": None,
            "crop_paths": [],
            "representative_embedding": [0.0, 0.0, 0.0, 1.0] + [0.0] * 124,
            "member_faces": ["u2_0.jpg:0", "u2_0.jpg:1"],
        },
    ]

    # File assignments:
    cm.file_groups = {
        # group_001: 2 files
        "z_file_1.jpg": ["group_001"] * 5,
        "z_file_2.jpg": ["group_001"] * 5,
        # group_002: 6 files
        "a_file_1.jpg": ["group_002"],
        "a_file_2.jpg": ["group_002"],
        "a_file_3.jpg": ["group_002"],
        "a_file_4.jpg": ["group_002"],
        "a_file_5.jpg": ["group_002"],
        "a_file_6.jpg": ["group_002"],
        # group_003: 5 files
        "u1_file_1.jpg": ["group_003"] * 4,
        "u1_file_2.jpg": ["group_003"] * 4,
        "u1_file_3.jpg": ["group_003"] * 4,
        "u1_file_4.jpg": ["group_003"] * 4,
        "u1_file_5.jpg": ["group_003"] * 4,
        # group_004: 1 file
        "u2_file_1.jpg": ["group_004", "group_004"],
    }
    cm.save()

    assert pm.get_group_file_count("group_001") == 2
    assert pm.get_group_file_count("group_002") == 6
    assert pm.get_group_file_count("group_003") == 5
    assert pm.get_group_file_count("group_004") == 1

    visible = pm.get_visible_groups()

    # 1. "Most photos": sorted descending by photo (file) count
    # 6 files (group_002) > 5 files (group_003) > 2 files (group_001) > 1 file (group_004)
    res_most = pm.filter_and_sort_groups(visible, sort_by="Most photos")
    assert [g["id"] for g in res_most] == ["group_002", "group_003", "group_001", "group_004"]

    # 2. "Fewest photos": sorted ascending by photo (file) count
    # 1 file (group_004) < 2 files (group_001) < 5 files (group_003) < 6 files (group_002)
    res_fewest = pm.filter_and_sort_groups(visible, sort_by="Fewest photos")
    assert [g["id"] for g in res_fewest] == ["group_004", "group_001", "group_003", "group_002"]

    # 3. "Name A–Z": named groups sorted alphabetically first, unnamed groups sort after
    # Named: Alice ("group_002"), Zara ("group_001")
    # Unnamed: Unnamed person 1 ("group_003"), Unnamed person 2 ("group_004")
    res_name = pm.filter_and_sort_groups(visible, sort_by="Name A–Z")
    assert [g["id"] for g in res_name] == ["group_002", "group_001", "group_003", "group_004"]


def test_sorting_and_searching_do_not_mutate_stored_data(tmp_path: Path):
    """Test that sorting and searching are strictly for display and never mutate stored data."""
    runs_dir = tmp_path / "runs"
    cm, pm = _create_test_manager(runs_dir)

    cm.groups = [
        {"id": "group_001", "name": "zara", "display_name": "Zara", "crop_paths": []},
        {"id": "group_002", "name": "alice", "display_name": "Alice", "crop_paths": []},
        {"id": "group_003", "name": None, "display_name": None, "crop_paths": []},
    ]
    cm.file_groups = {
        "f1.jpg": ["group_001", "group_001"],
        "f2.jpg": ["group_002", "group_002"],
        "f3.jpg": ["group_003", "group_003"],
    }
    cm.save()

    faces_json = runs_dir / "faces.json"
    content_before = faces_json.read_text(encoding="utf-8")
    groups_before = json.loads(json.dumps(cm.groups))
    file_groups_before = json.loads(json.dumps(cm.file_groups))

    # Execute multiple filter and sort passes
    pm.filter_and_sort_groups(search_query="alice", sort_by="Most photos")
    pm.filter_and_sort_groups(search_query="zara", sort_by="Fewest photos")
    pm.filter_and_sort_groups(search_query="person", sort_by="Name A–Z")
    pm.filter_and_sort_groups(search_query="nomatch", sort_by="Most photos")

    # Stored file must be identical
    content_after = faces_json.read_text(encoding="utf-8")
    assert content_after == content_before

    # Internal state must not have reordered or modified original groups
    assert cm.groups == groups_before
    assert cm.file_groups == file_groups_before


def test_ui_smoke_search_box_sort_dropdown_and_large_group_naming(tmp_path: Path):
    """UI smoke test: verify search entry, sort combobox, card counts, empty message, and 'Name this group'."""
    try:
        root = tk.Tk()
    except Exception as e:
        pytest.skip(f"Tkinter unavailable in environment: {e}")

    try:
        root.withdraw()
        runs_dir = tmp_path / "runs"
        runs_dir.mkdir(parents=True)
        (runs_dir / "faces.json").write_text("{}", encoding="utf-8")

        with patch("nexora.faces.groups.get_runs_dir", return_value=runs_dir):
            app = NexoraApp(root)
            cm = app.cluster_manager
            pm = app.people_manager

            cm.groups = [
                {
                    "id": "group_001",
                    "name": None,
                    "display_name": None,
                    "crop_paths": [],
                    "representative_embedding": [1.0] + [0.0] * 127,
                    "needs_review": True,
                    "member_faces": [f"f_{i}.jpg:0" for i in range(45)],
                },
                {
                    "id": "group_002",
                    "name": "alice",
                    "display_name": "Alice",
                    "crop_paths": [],
                    "representative_embedding": [0.0, 1.0] + [0.0] * 126,
                    "needs_review": False,
                    "member_faces": ["a1.jpg:0", "a2.jpg:0"],
                },
            ]
            cm.file_groups = {f"f_{i}.jpg": ["group_001"] for i in range(45)}
            cm.file_groups["a1.jpg"] = ["group_002"]
            cm.file_groups["a2.jpg"] = ["group_002"]
            cm.save()

            app.notebook.select(1)
            app.render_people_cards()

            # 1. Verify Toolbar components
            assert hasattr(app, "people_search_entry")
            assert hasattr(app, "people_sort_combobox")
            assert app.people_sort_combobox.cget("values") == ("Most photos", "Fewest photos", "Name A–Z")
            assert app.people_sort_var.get() == "Most photos"

            # 2. Verify Card Headers show face count AND file count
            # Find group cards
            cards = [
                child for child in app.people_scroll_frame.winfo_children()
                if isinstance(child, tk.Frame) and child not in (app.suggestions_frame, app.people_toolbar_frame)
            ]
            group_cards = [
                c for c in cards
                if any(isinstance(w, tk.Label) and "faces" in getattr(w, "cget", lambda x: "")("text")
                       for w in c.winfo_children() for w in w.winfo_children())
            ]
            assert len(group_cards) == 2

            # Find card_001 (needs review)
            card_001 = None
            for gc in group_cards:
                header = gc.winfo_children()[0]
                for w in header.winfo_children():
                    if isinstance(w, tk.Label) and "45 faces" in w.cget("text"):
                        card_001 = gc
                        # Verify file count is also present
                        assert "45 files" in w.cget("text")
            assert card_001 is not None

            # 3. Verify 'Name this group' action button at top of needs_review card
            header_001 = card_001.winfo_children()[0]
            name_btns = [w for w in header_001.winfo_children() if isinstance(w, tk.Button) and w.cget("text") == "Name this group"]
            assert len(name_btns) == 1

            # Click "Name this group" with mocked dialog and messagebox
            with patch("tkinter.simpledialog.askstring", return_value="David"), \
                 patch("tkinter.messagebox.showinfo"):
                name_btns[0].invoke()

            # Group is now named David, needs_review cleared
            assert cm.groups[0]["display_name"] == "David"
            assert cm.groups[0]["needs_review"] is False

            # 4. Search box filter test in UI: No match shows empty message
            app.people_search_var.set("Nonexistent Person")
            app.render_people_cards()

            no_match_labels = [
                w for w in app.people_scroll_frame.winfo_children()
                if isinstance(w, tk.Label) and "No people match 'Nonexistent Person'." in w.cget("text")
            ]
            assert len(no_match_labels) == 1

            # Reset search shows all cards again
            app.people_search_var.set("")
            app.render_people_cards()
            cards_after_reset = [
                c for c in app.people_scroll_frame.winfo_children()
                if isinstance(c, tk.Frame) and c not in (app.suggestions_frame, app.people_toolbar_frame)
            ]
            group_cards_after = [
                c for c in cards_after_reset
                if any(isinstance(w, tk.Label) and "faces" in getattr(w, "cget", lambda x: "")("text")
                       for w in c.winfo_children() for w in w.winfo_children())
            ]
            assert len(group_cards_after) == 2

    finally:
        root.destroy()
