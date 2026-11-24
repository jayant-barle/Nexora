"""Tests for split group persistence across naming and re-clustering."""

from pathlib import Path
import pytest

from nexora.faces.groups import FaceClusterManager
from nexora.faces.people import PeopleManager


def test_split_group_persistence(tmp_path: Path):
    json_path = tmp_path / "faces.json"
    cm = FaceClusterManager(json_path=json_path)

    emb_a = [1.0] + [0.0] * 127
    emb_b = [0.0, 1.0] + [0.0] * 126

    # 4 faces: 2 from person A, 2 from person B
    cm.cache = {
        "file_a.jpg": {"size": 100, "sha256": "sha_a", "faces": [{"embedding": emb_a}, {"embedding": emb_a}]},
        "file_b.jpg": {"size": 200, "sha256": "sha_b", "faces": [{"embedding": emb_b}, {"embedding": emb_b}]},
    }
    cm.file_groups = {
        "file_a.jpg": ["group_001", "group_001"],
        "file_b.jpg": ["group_001", "group_001"],
    }
    cm.groups = [
        {
            "id": "group_001",
            "name": None,
            "display_name": None,
            "member_faces": ["file_a.jpg:0", "file_a.jpg:1", "file_b.jpg:0", "file_b.jpg:1"],
            "representative_embedding": emb_a,
        }
    ]
    cm.save()

    pm = PeopleManager(cm)
    orig_id, new_id = pm.split_group("group_001")

    # Verify split persisted face membership for both groups
    orig_group = next(g for g in cm.groups if g["id"] == orig_id)
    new_group = next(g for g in cm.groups if g["id"] == new_id)
    assert set(orig_group.get("member_faces", [])) == {"file_a.jpg:0", "file_a.jpg:1"}
    assert set(new_group.get("member_faces", [])) == {"file_b.jpg:0", "file_b.jpg:1"}

    # Name original group "Ali", name new group "Sara"
    pm.name_group(orig_id, "Ali")
    assert cm.face_names.get("file_b.jpg:0") != "Ali"
    assert cm.face_names.get("file_b.jpg:1") != "Ali"
    pm.name_group(new_id, "Sara")

    # Run the rescan path (cluster_all_faces on the same cache)
    cm.cluster_all_faces()

    # Find group with display_name "Ali" and "Sara"
    ali_group = next((g for g in cm.groups if g.get("display_name") == "Ali"), None)
    sara_group = next((g for g in cm.groups if g.get("display_name") == "Sara"), None)

    assert ali_group is not None, "Group named Ali must exist after rescan"
    assert sara_group is not None, "Group named Sara must exist after rescan"

    ali_members = set(ali_group.get("member_faces", []))
    sara_members = set(sara_group.get("member_faces", []))

    assert "file_a.jpg:0" in ali_members
    assert "file_a.jpg:1" in ali_members
    assert "file_b.jpg:0" in sara_members
    assert "file_b.jpg:1" in sara_members
    assert ali_members.isdisjoint(sara_members), "No face should be in both groups"


def test_split_group_naming_order_and_unnamed_persistence(tmp_path: Path):
    """Naming new group before original group, or leaving new group unnamed, persists separation."""
    json_path = tmp_path / "faces.json"
    cm = FaceClusterManager(json_path=json_path)

    emb_a = [1.0] + [0.0] * 127
    emb_b = [0.0, 1.0] + [0.0] * 126

    cm.cache = {
        "file_a.jpg": {"size": 100, "sha256": "sha_a", "faces": [{"embedding": emb_a}, {"embedding": emb_a}]},
        "file_b.jpg": {"size": 200, "sha256": "sha_b", "faces": [{"embedding": emb_b}, {"embedding": emb_b}]},
    }
    cm.file_groups = {
        "file_a.jpg": ["group_001", "group_001"],
        "file_b.jpg": ["group_001", "group_001"],
    }
    cm.groups = [
        {
            "id": "group_001",
            "name": None,
            "display_name": None,
            "member_faces": ["file_a.jpg:0", "file_a.jpg:1", "file_b.jpg:0", "file_b.jpg:1"],
            "representative_embedding": emb_a,
        }
    ]
    cm.save()

    pm = PeopleManager(cm)
    orig_id, new_id = pm.split_group("group_001")

    # Name new group "Sara" first, then original group "Ali"
    pm.name_group(new_id, "Sara")
    pm.name_group(orig_id, "Ali")

    cm.cluster_all_faces()

    ali_group = next((g for g in cm.groups if g.get("display_name") == "Ali"), None)
    sara_group = next((g for g in cm.groups if g.get("display_name") == "Sara"), None)

    assert ali_group is not None, "Ali group must exist"
    assert sara_group is not None, "Sara group must exist and not be overwritten by Ali"
    assert set(ali_group.get("member_faces", [])) == {"file_a.jpg:0", "file_a.jpg:1"}
    assert set(sara_group.get("member_faces", [])) == {"file_b.jpg:0", "file_b.jpg:1"}


def test_split_group_already_named_clears_split_faces_from_face_names(tmp_path: Path):
    """When a group was already named before split, splitting clears the old name from new group's faces."""
    json_path = tmp_path / "faces.json"
    cm = FaceClusterManager(json_path=json_path)

    emb_a = [1.0] + [0.0] * 127
    emb_b = [0.0, 1.0] + [0.0] * 126

    cm.cache = {
        "file_a.jpg": {"size": 100, "sha256": "sha_a", "faces": [{"embedding": emb_a}, {"embedding": emb_a}]},
        "file_b.jpg": {"size": 200, "sha256": "sha_b", "faces": [{"embedding": emb_b}, {"embedding": emb_b}]},
    }
    cm.file_groups = {
        "file_a.jpg": ["group_001", "group_001"],
        "file_b.jpg": ["group_001", "group_001"],
    }
    cm.groups = [
        {
            "id": "group_001",
            "name": "ali",
            "display_name": "Ali",
            "member_faces": ["file_a.jpg:0", "file_a.jpg:1", "file_b.jpg:0", "file_b.jpg:1"],
            "representative_embedding": emb_a,
        }
    ]
    cm.face_names = {
        "file_a.jpg:0": "Ali",
        "file_a.jpg:1": "Ali",
        "file_b.jpg:0": "Ali",
        "file_b.jpg:1": "Ali",
    }
    cm.save()

    pm = PeopleManager(cm)
    orig_id, new_id = pm.split_group("group_001")

    # Person B's faces should no longer be named Ali in face_names
    assert cm.face_names.get("file_b.jpg:0") is None
    assert cm.face_names.get("file_b.jpg:1") is None
    # Person A's faces still retain Ali
    assert cm.face_names.get("file_a.jpg:0") == "Ali"
    assert cm.face_names.get("file_a.jpg:1") == "Ali"

    # Rescan keeps person B unnamed and person A named Ali
    cm.cluster_all_faces()
    ali_group = next((g for g in cm.groups if g.get("display_name") == "Ali"), None)
    unnamed_b_group = next((g for g in cm.groups if "file_b.jpg:0" in g.get("member_faces", [])), None)

    assert ali_group is not None
    assert unnamed_b_group is not None
    assert unnamed_b_group.get("display_name") is None
    assert set(ali_group.get("member_faces", [])) == {"file_a.jpg:0", "file_a.jpg:1"}
    assert set(unnamed_b_group.get("member_faces", [])) == {"file_b.jpg:0", "file_b.jpg:1"}

