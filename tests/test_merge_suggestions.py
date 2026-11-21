"""Tests for merge suggestion engine, dismissal tracking, UI section, and safety."""

from __future__ import annotations

import json
import threading
from pathlib import Path
from unittest.mock import patch
import numpy as np
import pytest
import tkinter as tk

from nexora.faces.groups import FaceClusterManager
from nexora.faces.people import PeopleManager, MIN_VISIBLE_GROUP_SIZE
from nexora.faces.suggestions import (
    MERGE_SUGGEST_THRESHOLD,
    MAX_MERGE_SUGGESTIONS,
    compute_pair_dismissal_key,
    find_merge_suggestions,
)
from nexora.plan import build_plan
from nexora.ui import NexoraApp


def _create_mock_cluster_manager(tmp_path: Path) -> FaceClusterManager:
    runs_dir = tmp_path / "runs"
    runs_dir.mkdir(parents=True, exist_ok=True)
    json_path = runs_dir / "faces.json"
    return FaceClusterManager(json_path=json_path)


def test_similar_groups_produce_suggestion_and_dissimilar_produce_none(tmp_path: Path):
    """Two groups with similarity >= 0.363 produce a suggestion; dissimilar groups produce none."""
    cm = _create_mock_cluster_manager(tmp_path)
    pm = PeopleManager(cm)

    # Identical or near-identical embeddings (cosine similarity ~1.0 >= 0.363)
    emb_a = [1.0, 0.0] + [0.0] * 126
    emb_b = [0.99, 0.01] + [0.0] * 126

    # Orthogonal embedding (cosine similarity 0.0 < 0.363)
    emb_c = [0.0, 1.0] + [0.0] * 126

    cm.groups = [
        {
            "id": "group_001",
            "name": None,
            "display_name": None,
            "crop_paths": [],
            "representative_embedding": emb_a,
            "member_faces": ["file1.jpg:0", "file2.jpg:0"],
        },
        {
            "id": "group_002",
            "name": None,
            "display_name": None,
            "crop_paths": [],
            "representative_embedding": emb_b,
            "member_faces": ["file3.jpg:0", "file4.jpg:0"],
        },
        {
            "id": "group_003",
            "name": None,
            "display_name": None,
            "crop_paths": [],
            "representative_embedding": emb_c,
            "member_faces": ["file5.jpg:0", "file6.jpg:0"],
        },
    ]
    cm.file_groups = {
        "file1.jpg": ["group_001"],
        "file2.jpg": ["group_001"],
        "file3.jpg": ["group_002"],
        "file4.jpg": ["group_002"],
        "file5.jpg": ["group_003"],
        "file6.jpg": ["group_003"],
    }

    suggestions, total_count = pm.get_merge_suggestions()
    # Exactly one suggestion: group_001 and group_002
    assert total_count == 1
    assert len(suggestions) == 1
    s = suggestions[0]
    pair_ids = {s["group_a_id"], s["group_b_id"]}
    assert pair_ids == {"group_001", "group_002"}
    assert s["similarity"] >= MERGE_SUGGEST_THRESHOLD


def test_dismissed_pair_not_suggested_again_including_after_rescan(tmp_path: Path):
    """A dismissed pair is not suggested again, including after a rescan that keeps the same members."""
    src = tmp_path / "src"
    src.mkdir()
    runs_dir = tmp_path / "runs"
    runs_dir.mkdir()
    json_path = runs_dir / "faces.json"

    cm = FaceClusterManager(json_path=json_path)
    pm = PeopleManager(cm)

    # 4 synthetic image files in src
    files = [src / f"img_{i}.jpg" for i in range(4)]
    for f in files:
        f.write_bytes(b"dummy")

    emb_1 = [1.0, 0.0] + [0.0] * 126
    emb_2 = [0.98, 0.02] + [0.0] * 126

    cm.groups = [
        {
            "id": "group_001",
            "name": None,
            "display_name": None,
            "crop_paths": [],
            "representative_embedding": emb_1,
            "member_faces": [f"{files[0].resolve()}:0", f"{files[1].resolve()}:0"],
        },
        {
            "id": "group_002",
            "name": None,
            "display_name": None,
            "crop_paths": [],
            "representative_embedding": emb_2,
            "member_faces": [f"{files[2].resolve()}:0", f"{files[3].resolve()}:0"],
        },
    ]
    cm.file_groups = {
        str(files[0].resolve()): ["group_001"],
        str(files[1].resolve()): ["group_001"],
        str(files[2].resolve()): ["group_002"],
        str(files[3].resolve()): ["group_002"],
    }
    cm.save()

    # Initially 1 suggestion
    suggestions, total = pm.get_merge_suggestions()
    assert len(suggestions) == 1

    # Dismiss the pair
    pm.dismiss_merge("group_001", "group_002")

    # Dismissal is persisted to disk
    assert len(cm.dismissed_merges) == 1
    with open(json_path, "r", encoding="utf-8") as jf:
        data = json.load(jf)
    assert len(data.get("dismissed_merges", [])) == 1

    # In-memory suggestion check
    suggestions_after, total_after = pm.get_merge_suggestions()
    assert len(suggestions_after) == 0
    assert total_after == 0

    # Simulate reload & rescan
    cm_reloaded = FaceClusterManager(json_path=json_path)
    pm_reloaded = PeopleManager(cm_reloaded)
    assert len(cm_reloaded.dismissed_merges) == 1

    # Even if groups are re-clustered or IDs shuffled, member faces are preserved
    cm_reloaded.groups = [
        {
            "id": "group_renumbered_999",
            "name": None,
            "display_name": None,
            "crop_paths": [],
            "representative_embedding": emb_1,
            "member_faces": [f"{files[0].resolve()}:0", f"{files[1].resolve()}:0"],
        },
        {
            "id": "group_renumbered_888",
            "name": None,
            "display_name": None,
            "crop_paths": [],
            "representative_embedding": emb_2,
            "member_faces": [f"{files[2].resolve()}:0", f"{files[3].resolve()}:0"],
        },
    ]
    cm_reloaded.file_groups = {
        str(files[0].resolve()): ["group_renumbered_999"],
        str(files[1].resolve()): ["group_renumbered_999"],
        str(files[2].resolve()): ["group_renumbered_888"],
        str(files[3].resolve()): ["group_renumbered_888"],
    }

    suggestions_rescan, total_rescan = pm_reloaded.get_merge_suggestions()
    assert len(suggestions_rescan) == 0
    assert total_rescan == 0


def test_already_named_pairs_with_same_name_not_suggested(tmp_path: Path):
    """Already-named pairs sharing the same name are not suggested; differently named or unnamed pairs are."""
    cm = _create_mock_cluster_manager(tmp_path)
    pm = PeopleManager(cm)

    emb = [1.0] * 128

    cm.groups = [
        {
            "id": "group_001",
            "name": "alice",
            "display_name": "Alice",
            "crop_paths": [],
            "representative_embedding": emb,
            "member_faces": ["file1.jpg:0", "file2.jpg:0"],
        },
        {
            "id": "group_002",
            "name": "alice",
            "display_name": "Alice",
            "crop_paths": [],
            "representative_embedding": emb,
            "member_faces": ["file3.jpg:0", "file4.jpg:0"],
        },
        {
            "id": "group_003",
            "name": "bob",
            "display_name": "Bob",
            "crop_paths": [],
            "representative_embedding": emb,
            "member_faces": ["file5.jpg:0", "file6.jpg:0"],
        },
        {
            "id": "group_004",
            "name": None,
            "display_name": None,
            "crop_paths": [],
            "representative_embedding": emb,
            "member_faces": ["file7.jpg:0", "file8.jpg:0"],
        },
    ]
    cm.file_groups = {
        "file1.jpg": ["group_001"],
        "file2.jpg": ["group_001"],
        "file3.jpg": ["group_002"],
        "file4.jpg": ["group_002"],
        "file5.jpg": ["group_003"],
        "file6.jpg": ["group_003"],
        "file7.jpg": ["group_004"],
        "file8.jpg": ["group_004"],
    }

    suggestions, total = pm.get_merge_suggestions()
    # Candidates among 4 groups = 6 pairs.
    # (group_001, group_002) both have name "alice" -> excluded.
    # The remaining 5 pairs: (001, 003), (001, 004), (002, 003), (002, 004), (003, 004) -> all suggested!
    assert total == 5
    assert len(suggestions) == 5

    pairs = [{s["group_a_id"], s["group_b_id"]} for s in suggestions]
    assert {"group_001", "group_002"} not in pairs


def test_cap_of_50_applied_and_reported(tmp_path: Path):
    """The cap of 50 is applied and reported when more suggestions exist."""
    cm = _create_mock_cluster_manager(tmp_path)
    pm = PeopleManager(cm)

    # Create 20 groups all with identical embeddings.
    # Total pairs = 20 * 19 / 2 = 190 pairs > 50 cap.
    emb = [1.0] * 128
    cm.groups = []
    cm.file_groups = {}
    for i in range(20):
        gid = f"group_{i:03d}"
        f1 = f"file_{i}_a.jpg"
        f2 = f"file_{i}_b.jpg"
        cm.groups.append({
            "id": gid,
            "name": None,
            "display_name": None,
            "crop_paths": [],
            "representative_embedding": emb,
            "member_faces": [f"{f1}:0", f"{f2}:0"],
        })
        cm.file_groups[f1] = [gid]
        cm.file_groups[f2] = [gid]

    capped_suggestions, total_count = pm.get_merge_suggestions()
    assert total_count == 190, f"Expected 190 total suggestions, got {total_count}"
    assert len(capped_suggestions) == 50, f"Expected capped at 50, got {len(capped_suggestions)}"
    assert MAX_MERGE_SUGGESTIONS == 50


def test_merging_suggested_pair_uses_merge_groups_and_leaves_rest_unchanged(tmp_path: Path):
    """Merging a suggested pair uses existing merge_groups and leaves other groups unchanged."""
    cm = _create_mock_cluster_manager(tmp_path)
    pm = PeopleManager(cm)

    emb = [1.0] * 128
    cm.groups = [
        {
            "id": "group_001",
            "name": "alice",
            "display_name": "Alice",
            "crop_paths": ["crop1.jpg"],
            "representative_embedding": emb,
            "member_faces": ["file1.jpg:0", "file2.jpg:0"],
        },
        {
            "id": "group_002",
            "name": None,
            "display_name": None,
            "crop_paths": ["crop2.jpg"],
            "representative_embedding": emb,
            "member_faces": ["file3.jpg:0", "file4.jpg:0"],
        },
        {
            "id": "group_003",
            "name": "charlie",
            "display_name": "Charlie",
            "crop_paths": ["crop3.jpg"],
            "representative_embedding": [0.0, 1.0] + [0.0] * 126,
            "member_faces": ["file5.jpg:0", "file6.jpg:0"],
        },
    ]
    cm.file_groups = {
        "file1.jpg": ["group_001"],
        "file2.jpg": ["group_001"],
        "file3.jpg": ["group_002"],
        "file4.jpg": ["group_002"],
        "file5.jpg": ["group_003"],
        "file6.jpg": ["group_003"],
    }

    # Suggestions before merge
    suggestions, _ = pm.get_merge_suggestions()
    assert len(suggestions) == 1
    s = suggestions[0]
    assert {s["group_a_id"], s["group_b_id"]} == {"group_001", "group_002"}

    # Merge group_002 into group_001
    pm.merge_groups("group_001", "group_002")

    # group_002 is removed
    remaining_ids = [g["id"] for g in pm.groups]
    assert remaining_ids == ["group_001", "group_003"]

    # All files from group_002 now point to group_001
    assert pm.file_groups["file3.jpg"] == ["group_001"]
    assert pm.file_groups["file4.jpg"] == ["group_001"]

    # group_003 (Charlie) is completely untouched
    charlie_group = next(g for g in pm.groups if g["id"] == "group_003")
    assert charlie_group["name"] == "charlie"
    assert charlie_group["crop_paths"] == ["crop3.jpg"]
    assert pm.file_groups["file5.jpg"] == ["group_003"]
    assert pm.file_groups["file6.jpg"] == ["group_003"]


def test_ui_smoke_suggested_merges_section_and_empty_message(tmp_path: Path):
    """UI smoke test: 'Suggested merges' section exists and shows 'No suggested merges.' when empty."""
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

            # Switch to People tab
            app.notebook.select(1)
            app.render_people_cards()

            assert hasattr(app, "suggestions_frame"), "UI must have suggestions_frame"

            # Check that "No suggested merges." is rendered in suggestions_frame
            labels = []
            for child in app.suggestions_frame.winfo_children():
                if isinstance(child, tk.Label):
                    labels.append(child.cget("text"))

            assert "Suggested Merges" in labels
            assert "No suggested merges." in labels
    finally:
        try:
            root.destroy()
        except Exception:
            pass


def test_safety_no_automatic_merge_and_plan_placement_preserved(tmp_path: Path):
    """Suggestions do not alter groups or file placement automatically; merge updates placement per plan rules."""
    src = tmp_path / "src"
    dest = tmp_path / "dest"
    src.mkdir()
    dest.mkdir()

    # Create dummy images
    f1 = src / "photo_01.jpg"
    f2 = src / "IMG_9999.jpg"
    f1.write_bytes(b"dummy1")
    f2.write_bytes(b"dummy2")

    cm = _create_mock_cluster_manager(tmp_path)
    pm = PeopleManager(cm)

    emb = [1.0] * 128
    cm.groups = [
        {
            "id": "group_001",
            "name": "alice",
            "display_name": "Alice",
            "crop_paths": [],
            "representative_embedding": emb,
            "member_faces": [f"{f1.resolve()}:0", f"{f1.resolve()}:1"],
        },
        {
            "id": "group_002",
            "name": None,
            "display_name": None,
            "crop_paths": [],
            "representative_embedding": emb,
            "member_faces": [f"{f2.resolve()}:0", f"{f2.resolve()}:1"],
        },
    ]
    cm.file_groups = {
        str(f1.resolve()): ["group_001", "group_001"],
        str(f2.resolve()): ["group_002", "group_002"],
    }
    cm.cache = {
        str(f1.resolve()): {"type": "image", "status": "ok", "faces": [{"box": [0,0,10,10]}, {"box": [20,20,30,30]}]},
        str(f2.resolve()): {"type": "image", "status": "ok", "faces": [{"box": [0,0,10,10]}, {"box": [20,20,30,30]}]},
    }

    # 1. Generating suggestions must NOT modify groups or file_groups
    suggestions, total = pm.get_merge_suggestions()
    assert total == 1
    assert len(cm.groups) == 2
    assert cm.file_groups[str(f2.resolve())] == ["group_002", "group_002"]

    # 2. Before merge:
    # f1 has visible named group 'Alice' -> goes to <dest>/Alice/alice_photo.jpg
    # f2 has unnamed group -> falls through to name rule ("unnamed" generic token -> Unsorted/)
    face_data_before = pm.get_face_data_for_plan()
    plan_before = build_plan(src, dest, face_data=face_data_before)
    plan_map_before = {str(item.source): str(item.target) for item in plan_before}

    assert "alice" in plan_map_before[str(f1.resolve())].lower()
    assert "unsorted" in plan_map_before[str(f2.resolve())].lower()

    # 3. Explicit merge by owner: merge group_002 into group_001 (Alice)
    pm.merge_groups("group_001", "group_002")
    assert len(cm.groups) == 1
    assert cm.file_groups[str(f2.resolve())] == ["group_001", "group_001"]

    # 4. After merge:
    # f2 now belongs to Alice -> goes to <dest>/Alice/unnamed_photo.jpg
    face_data_after = pm.get_face_data_for_plan()
    plan_after = build_plan(src, dest, face_data=face_data_after)
    plan_map_after = {str(item.source): str(item.target) for item in plan_after}

    assert "alice" in plan_map_after[str(f1.resolve())].lower()
    assert "alice" in plan_map_after[str(f2.resolve())].lower()
