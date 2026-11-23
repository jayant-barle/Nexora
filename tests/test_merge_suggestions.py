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


def test_reproduce_dismissed_pair_reappears_when_earlier_file_added(tmp_path: Path):
    """Reproduce issue: adding a face with an earlier file name changes top-5 key and causes dismissed pair to reappear."""
    src = tmp_path / "src"
    src.mkdir()
    runs_dir = tmp_path / "runs"
    runs_dir.mkdir()
    json_path = runs_dir / "faces.json"

    # Group A has files m_a1, m_a2; group B has files m_b1, m_b2
    # At clustering threshold 0.40, cosine 0.38 keeps them in separate clusters.
    # At suggestion threshold 0.363, cosine 0.38 suggests them as a merge pair.
    emb_a = [1.0, 0.0] + [0.0] * 126
    emb_b = [0.38, 0.925] + [0.0] * 126

    files = {
        "m_a1.jpg": emb_a,
        "m_a2.jpg": emb_a,
        "m_b1.jpg": emb_b,
        "m_b2.jpg": emb_b,
    }
    for fname in files:
        (src / fname).write_bytes(b"dummy_content_" + fname.encode())

    cm = FaceClusterManager(json_path=json_path)

    def mock_process_image(p: Path, sz: int, sha: str) -> list[dict]:
        emb = files.get(p.name, emb_a)
        return [{"box": [10, 10, 50, 50], "score": 0.9, "embedding": emb}]

    with patch.object(cm, "_process_image", side_effect=mock_process_image):
        cm.scan_source(src, threshold=0.40, max_workers=1)

    pm = PeopleManager(cm)
    assert len(pm.get_visible_groups()) == 2
    suggestions, total = pm.get_merge_suggestions()
    assert total == 1, f"Expected 1 suggestion, got {total}"
    s = suggestions[0]
    gid_a, gid_b = s["group_a_id"], s["group_b_id"]

    # Dismiss the pair
    pm.dismiss_merge(gid_a, gid_b)
    suggestions_after, total_after = pm.get_merge_suggestions()
    assert total_after == 0

    # Now add one new face with an earlier file name to group A: "aaa_a0.jpg"
    files["aaa_a0.jpg"] = emb_a
    (src / "aaa_a0.jpg").write_bytes(b"dummy_content_aaa_a0")

    # Rescan with normal scan path
    cm2 = FaceClusterManager(json_path=json_path)
    with patch.object(cm2, "_process_image", side_effect=mock_process_image):
        cm2.scan_source(src, threshold=0.40, max_workers=1)

    pm2 = PeopleManager(cm2)
    suggestions_rescan, total_rescan = pm2.get_merge_suggestions()
    # The pair must stay dismissed!
    assert total_rescan == 0, f"Expected 0 suggestions after rescan, but dismissed pair reappeared: {suggestions_rescan}"


def test_dismissed_pair_stays_dismissed_after_face_removed_from_group_b(tmp_path: Path):
    """Task 3b: Dismissed pair stays dismissed after one face is removed from group B, then rescan."""
    src = tmp_path / "src"
    src.mkdir()
    runs_dir = tmp_path / "runs"
    runs_dir.mkdir()
    json_path = runs_dir / "faces.json"

    emb_a = [1.0, 0.0] + [0.0] * 126
    emb_b = [0.38, 0.925] + [0.0] * 126

    # Group A has 3 faces, Group B has 3 faces
    files = {
        "m_a1.jpg": emb_a,
        "m_a2.jpg": emb_a,
        "m_a3.jpg": emb_a,
        "m_b1.jpg": emb_b,
        "m_b2.jpg": emb_b,
        "m_b3.jpg": emb_b,
    }
    for fname in files:
        (src / fname).write_bytes(b"dummy_content_" + fname.encode())

    cm = FaceClusterManager(json_path=json_path)

    def mock_process_image(p: Path, sz: int, sha: str) -> list[dict]:
        emb = files.get(p.name, emb_a)
        return [{"box": [10, 10, 50, 50], "score": 0.9, "embedding": emb}]

    with patch.object(cm, "_process_image", side_effect=mock_process_image):
        cm.scan_source(src, threshold=0.40, max_workers=1)

    pm = PeopleManager(cm)
    assert len(pm.get_visible_groups()) == 2
    suggestions, total = pm.get_merge_suggestions()
    assert total == 1
    s = suggestions[0]
    gid_a, gid_b = s["group_a_id"], s["group_b_id"]

    # Dismiss pair
    pm.dismiss_merge(gid_a, gid_b)
    assert len(pm.get_merge_suggestions()[0]) == 0

    # Remove m_b3.jpg from source
    (src / "m_b3.jpg").unlink()
    files.pop("m_b3.jpg")

    # Rescan
    cm2 = FaceClusterManager(json_path=json_path)
    with patch.object(cm2, "_process_image", side_effect=mock_process_image):
        cm2.scan_source(src, threshold=0.40, max_workers=1)

    pm2 = PeopleManager(cm2)
    # Group B still has 2 members >= MIN_VISIBLE_GROUP_SIZE (2 out of 3 stored members remain = 66.7% > 50%)
    assert len(pm2.get_visible_groups()) == 2
    suggestions_rescan, total_rescan = pm2.get_merge_suggestions()
    assert total_rescan == 0, f"Expected pair to stay dismissed after face removal, got {suggestions_rescan}"


def test_overlap_boundary_cutoff_at_point_five():
    """Task 3c: Check that cut-off is strictly > 0.5 (more than half). Exactly 50% overlap returns False; 75% returns True."""
    from nexora.faces.suggestions import is_pair_dismissed, DISMISSAL_OVERLAP_MIN
    assert DISMISSAL_OVERLAP_MIN == 0.5

    # Stored dismissal with 4 members in each group
    stored_record = {
        "key": "dummy_key",
        "members_a": ["f1:0", "f2:0", "f3:0", "f4:0"],
        "members_b": ["f5:0", "f6:0", "f7:0", "f8:0"],
    }
    dismissals = [stored_record]

    # Group B has all 4 members present
    group_b = {"id": "group_002", "member_faces": ["f5:0", "f6:0", "f7:0", "f8:0"]}

    # Case 1: Exactly 50% overlap (2 out of 4 members of group A present)
    # 2/4 = 0.50, which is NOT > 0.50 ("more than half"). Must NOT be dismissed (suggested again).
    group_a_boundary = {"id": "group_001", "member_faces": ["f1:0", "f2:0", "other1:0", "other2:0"]}
    assert is_pair_dismissed(group_a_boundary, group_b, dismissals) is False

    # Case 2: Above boundary (3 out of 4 members present = 75% > 50%)
    # 3/4 = 0.75 > 0.50. Must be dismissed.
    group_a_above = {"id": "group_001", "member_faces": ["f1:0", "f2:0", "f3:0", "other1:0"]}
    assert is_pair_dismissed(group_a_above, group_b, dismissals) is True

    # Case 3: Below boundary (1 out of 4 members present = 25% < 50%)
    group_a_below = {"id": "group_001", "member_faces": ["f1:0", "other1:0", "other2:0", "other3:0"]}
    assert is_pair_dismissed(group_a_below, group_b, dismissals) is False

    # Case 4: Group A has 75%, but Group B has exactly 50% (2 out of 4) -> False
    group_b_boundary = {"id": "group_002", "member_faces": ["f5:0", "f6:0", "other3:0", "other4:0"]}
    assert is_pair_dismissed(group_a_above, group_b_boundary, dismissals) is False


def test_old_format_dismissal_entry_still_works(tmp_path: Path):
    """Task 3d: Read old-format dismissal entries (string hash) and confirm they still dismiss matching pairs."""
    from nexora.faces.suggestions import compute_pair_dismissal_key, is_pair_dismissed

    group_a = {"id": "group_001", "member_faces": ["file1.jpg:0", "file2.jpg:0"]}
    group_b = {"id": "group_002", "member_faces": ["file3.jpg:0", "file4.jpg:0"]}

    exact_key = compute_pair_dismissal_key(group_a, group_b)

    # Old format: string key only
    old_dismissed_merges = [exact_key]

    # Matching pair is dismissed
    assert is_pair_dismissed(group_a, group_b, old_dismissed_merges) is True

    # Non-matching pair is not dismissed
    group_c = {"id": "group_003", "member_faces": ["file5.jpg:0", "file6.jpg:0"]}
    assert is_pair_dismissed(group_a, group_c, old_dismissed_merges) is False


def test_guard_small_cluster_cannot_absorb_cluster_more_than_twice_its_size(tmp_path: Path):
    """Task 3: A cluster with 3 or fewer faces must not absorb a cluster more than twice its size.
    
    Automatic merge path: assert that a 2-face cluster does not absorb a 45-face cluster when is_automatic=True.
    Manual merge path: assert that manual merges (is_automatic=False) are allowed.
    """
    cm = _create_mock_cluster_manager(tmp_path)
    pm = PeopleManager(cm)

    # Cluster A has 2 faces
    group_a_members = ["file_a1.jpg:0", "file_a2.jpg:0"]
    # Cluster B has 45 faces
    group_b_members = [f"file_b_{i:03d}.jpg:0" for i in range(45)]

    cm.groups = [
        {
            "id": "group_001",
            "name": None,
            "display_name": None,
            "crop_paths": [],
            "representative_embedding": [1.0] + [0.0] * 127,
            "member_faces": list(group_a_members),
        },
        {
            "id": "group_002",
            "name": None,
            "display_name": None,
            "crop_paths": [],
            "representative_embedding": [1.0] + [0.0] * 127,
            "member_faces": list(group_b_members),
        },
    ]
    cm.file_groups = {
        "file_a1.jpg": ["group_001"],
        "file_a2.jpg": ["group_001"],
    }
    for i in range(45):
        cm.file_groups[f"file_b_{i:03d}.jpg"] = ["group_002"]

    assert pm.get_group_size("group_001") == 2
    assert pm.get_group_size("group_002") == 45

    # Path 1: Automatic merge is refused by guard
    merged_auto = pm.merge_groups("group_001", "group_002", is_automatic=True)
    assert merged_auto is False
    assert pm.get_group_size("group_001") == 2
    assert pm.get_group_size("group_002") == 45
    assert len(pm.groups) == 2

    # Path 2: Manual merge is allowed
    merged_manual = pm.merge_groups("group_001", "group_002", is_automatic=False)
    assert merged_manual is True
    assert pm.get_group_size("group_001") == 47
    assert len(pm.groups) == 1
    assert "group_002" not in [g["id"] for g in pm.groups]

    # Also verify Pass 2 behavior: if pass2 is enabled on clusters where centroid cosine is 0.38 >= 0.363,
    # the guard ensures the 2-face cluster does not absorb the 45-face cluster.
    import math
    v_a = [1.0, 0.0] + [0.0] * 126
    v_b0 = [0.30, math.sqrt(1.0 - 0.30**2)] + [0.0] * 126
    v_b = [0.38, math.sqrt(1.0 - 0.38**2)] + [0.0] * 126

    cm2 = FaceClusterManager(json_path=tmp_path / "faces2.json")
    cm2.cache = {
        "fa1.jpg": {"size": 1, "sha256": "s1", "type": "image", "status": "ok", "faces": [{"box": [0, 0, 10, 10], "embedding": v_a}]},
        "fa2.jpg": {"size": 1, "sha256": "s2", "type": "image", "status": "ok", "faces": [{"box": [0, 0, 10, 10], "embedding": v_a}]},
        "fb_000.jpg": {"size": 1, "sha256": "sb_0", "type": "image", "status": "ok", "faces": [{"box": [0, 0, 10, 10], "embedding": v_b0}]},
    }
    for i in range(1, 45):
        cm2.cache[f"fb_{i:03d}.jpg"] = {
            "size": 1,
            "sha256": f"sb_{i}",
            "type": "image",
            "status": "ok",
            "faces": [{"box": [0, 0, 10, 10], "embedding": v_b}],
        }
    cm2.cluster_all_faces(threshold=0.363, pass2_enabled=True)
    pm2 = PeopleManager(cm2)
    sizes = [pm2.get_group_size(g["id"]) for g in pm2.groups]
    assert 2 in sizes, f"Expected 2-face cluster to remain unabsorbed, got sizes: {sizes}"
    assert 45 in sizes, f"Expected 45-face cluster to remain unabsorbed, got sizes: {sizes}"


def test_ui_manual_merge_confirmation_dialog_paths(tmp_path: Path):
    """UI confirmation test:
    For a manual merge that the guard would refuse, prompt:
    'This merges N faces into a group of M faces. Continue?'
    Test both user confirmation paths (accepted and declined).
    """
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

            # Setup 2 groups: group_001 (2 faces), group_002 (45 faces)
            cm = app.cluster_manager
            pm = app.people_manager

            group_a_members = ["file_a1.jpg:0", "file_a2.jpg:0"]
            group_b_members = [f"file_b_{i:03d}.jpg:0" for i in range(45)]

            cm.groups = [
                {
                    "id": "group_001",
                    "name": None,
                    "display_name": None,
                    "crop_paths": [],
                    "representative_embedding": [1.0] + [0.0] * 127,
                    "member_faces": list(group_a_members),
                },
                {
                    "id": "group_002",
                    "name": None,
                    "display_name": None,
                    "crop_paths": [],
                    "representative_embedding": [1.0] + [0.0] * 127,
                    "member_faces": list(group_b_members),
                },
            ]
            cm.file_groups = {
                "file_a1.jpg": ["group_001"],
                "file_a2.jpg": ["group_001"],
            }
            for i in range(45):
                cm.file_groups[f"file_b_{i:03d}.jpg"] = ["group_002"]

            cm.save()
            app.notebook.select(1)
            app.render_people_cards()

            # Guard check: would refuse if automatic
            assert pm.would_guard_refuse_merge("group_001", "group_002") is True

            # Find the "Merge" button in the Suggested Merges section
            # The suggestions_frame contains the suggested merge card
            merge_btn = None
            for child in app.suggestions_frame.winfo_children():
                if isinstance(child, tk.Frame):
                    # Card frame
                    for sub in child.winfo_children():
                        if isinstance(sub, tk.Frame):
                            # Content row
                            for btn_box in sub.winfo_children():
                                if isinstance(btn_box, tk.Frame):
                                    for b in btn_box.winfo_children():
                                        if isinstance(b, tk.Button) and b.cget("text") == "Merge":
                                            merge_btn = b
                                            break

            assert merge_btn is not None, "Suggested merge 'Merge' button should be rendered in UI"

            # 1. User declines confirmation dialog
            with patch("tkinter.messagebox.askyesno", return_value=False) as mock_ask, \
                 patch("tkinter.messagebox.showinfo") as mock_info:
                merge_btn.invoke()

                mock_ask.assert_called_once_with(
                    "Confirm Merge",
                    "This merges 45 faces into a group of 2 faces. Continue?",
                )
                assert mock_info.call_count == 0
                assert pm.get_group_size("group_001") == 2
                assert pm.get_group_size("group_002") == 45
                assert len(pm.groups) == 2

            # 2. User accepts confirmation dialog
            with patch("tkinter.messagebox.askyesno", return_value=True) as mock_ask, \
                 patch("tkinter.messagebox.showinfo") as mock_info:
                merge_btn.invoke()

                mock_ask.assert_called_once_with(
                    "Confirm Merge",
                    "This merges 45 faces into a group of 2 faces. Continue?",
                )
                assert mock_info.call_count == 1
                assert pm.get_group_size("group_001") == 47
                assert len(pm.groups) == 1
                assert "group_002" not in [g["id"] for g in pm.groups]
    finally:
        try:
            root.destroy()
        except Exception:
            pass


def test_ui_card_dropdown_merge_confirmation_and_unrestricted_paths(tmp_path: Path):
    """UI test for card dropdown merge:
    - When guard would refuse (e.g. 45 faces merged into 2 faces), prompt confirmation.
    - When guard does not trigger (e.g. 2 faces merged into 45 faces), merge directly without prompt.
    """
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

            group_a_members = ["file_a1.jpg:0", "file_a2.jpg:0"]
            group_b_members = [f"file_b_{i:03d}.jpg:0" for i in range(45)]

            cm.groups = [
                {
                    "id": "group_001",
                    "name": None,
                    "display_name": None,
                    "crop_paths": [],
                    "representative_embedding": [1.0] + [0.0] * 127,
                    "member_faces": list(group_a_members),
                },
                {
                    "id": "group_002",
                    "name": None,
                    "display_name": None,
                    "crop_paths": [],
                    "representative_embedding": [0.0, 1.0] + [0.0] * 126,  # dissimilar so no suggested merge
                    "member_faces": list(group_b_members),
                },
            ]
            cm.file_groups = {
                "file_a1.jpg": ["group_001"],
                "file_a2.jpg": ["group_001"],
            }
            for i in range(45):
                cm.file_groups[f"file_b_{i:03d}.jpg"] = ["group_002"]

            cm.save()
            app.notebook.select(1)
            app.render_people_cards()

            # Find cards in people_scroll_frame (skip suggestions_frame and withheld_frame)
            cards = [
                child for child in app.people_scroll_frame.winfo_children()
                if isinstance(child, tk.Frame) and child != app.suggestions_frame
            ]
            # There are 2 group cards and 1 withheld frame
            group_cards = [c for c in cards if any(isinstance(w, tk.Label) and "faces)" in getattr(w, "cget", lambda x: "")("text") for w in c.winfo_children() for w in w.winfo_children())]

            # Find the card for group_002 (45 faces)
            card_002 = None
            for gc in group_cards:
                header = gc.winfo_children()[0]
                for lbl in header.winfo_children():
                    if isinstance(lbl, tk.Label) and "45 faces" in lbl.cget("text"):
                        card_002 = gc
                        break

            assert card_002 is not None

            # Controls row is the 4th child (header, status, crops, controls)
            controls = card_002.winfo_children()[3]
            merge_btn_002 = [w for w in controls.winfo_children() if isinstance(w, tk.Button) and w.cget("text") == "Merge"][0]

            # 1. Merging group_002 (45 faces) into group_001 (2 faces) triggers guard confirmation
            with patch("tkinter.messagebox.askyesno", return_value=False) as mock_ask, \
                 patch("tkinter.messagebox.showinfo") as mock_info:
                merge_btn_002.invoke()
                mock_ask.assert_called_once_with(
                    "Confirm Merge",
                    "This merges 45 faces into a group of 2 faces. Continue?",
                )
                assert mock_info.call_count == 0
                assert pm.get_group_size("group_001") == 2
                assert pm.get_group_size("group_002") == 45

            # 2. Merging group_001 (2 faces) into group_002 (45 faces) does NOT trigger guard confirmation
            # Find card for group_001
            card_001 = None
            for gc in group_cards:
                header = gc.winfo_children()[0]
                for lbl in header.winfo_children():
                    if isinstance(lbl, tk.Label) and "2 faces" in lbl.cget("text"):
                        card_001 = gc
                        break
            assert card_001 is not None
            controls_001 = card_001.winfo_children()[3]
            merge_btn_001 = [w for w in controls_001.winfo_children() if isinstance(w, tk.Button) and w.cget("text") == "Merge"][0]

            with patch("tkinter.messagebox.askyesno") as mock_ask, \
                 patch("tkinter.messagebox.showinfo") as mock_info:
                merge_btn_001.invoke()
                # Should not prompt confirmation since target (group_002) has 45 faces (> 3)
                assert mock_ask.call_count == 0
                assert mock_info.call_count == 1
                assert pm.get_group_size("group_002") == 47
                assert len(pm.groups) == 1
    finally:
        try:
            root.destroy()
        except Exception:
            pass


