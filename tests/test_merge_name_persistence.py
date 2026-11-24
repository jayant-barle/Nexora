"""Tests for merge group name persistence across re-clustering (AGENTS.md Rule 4)."""

from pathlib import Path
import pytest

from nexora.faces.groups import FaceClusterManager
from nexora.faces.people import PeopleManager


def test_merge_unnamed_into_named_group_persists_name_on_rescan(tmp_path: Path):
    """When an unnamed group is merged into a named target group:

    1. cm.face_names has an entry for all moved faces.
    2. After rescan (cluster_all_faces), all 4 faces are still in a group named 'Ali'.
    """
    json_path = tmp_path / "faces.json"
    cm = FaceClusterManager(json_path=json_path)

    emb_a = [1.0] + [0.0] * 127
    emb_b = [0.0, 1.0] + [0.0] * 126

    # 4 faces: 2 from group A, 2 from group B
    cm.cache = {
        "file_a.jpg": {
            "size": 100,
            "sha256": "sha_a",
            "faces": [{"embedding": emb_a}, {"embedding": emb_a}],
        },
        "file_b.jpg": {
            "size": 200,
            "sha256": "sha_b",
            "faces": [{"embedding": emb_b}, {"embedding": emb_b}],
        },
    }
    cm.file_groups = {
        "file_a.jpg": ["group_001", "group_001"],
        "file_b.jpg": ["group_002", "group_002"],
    }
    cm.groups = [
        {
            "id": "group_001",
            "name": None,
            "display_name": None,
            "member_faces": ["file_a.jpg:0", "file_a.jpg:1"],
            "representative_embedding": emb_a,
            "crop_paths": [],
        },
        {
            "id": "group_002",
            "name": None,
            "display_name": None,
            "member_faces": ["file_b.jpg:0", "file_b.jpg:1"],
            "representative_embedding": emb_b,
            "crop_paths": [],
        },
    ]
    cm.save()

    pm = PeopleManager(cm)
    pm.name_group("group_001", "Ali")

    # Group A is now named "Ali", Group B is unnamed
    assert cm.face_names.get("file_a.jpg:0") == "Ali"
    assert cm.face_names.get("file_a.jpg:1") == "Ali"
    assert cm.face_names.get("file_b.jpg:0") is None
    assert cm.face_names.get("file_b.jpg:1") is None

    # Merge group B into group A
    merged = pm.merge_groups("group_001", "group_002")
    assert merged is True

    # Run the rescan path (cluster_all_faces on the same cache)
    cm.cluster_all_faces()

    expected_faces = ["file_a.jpg:0", "file_a.jpg:1", "file_b.jpg:0", "file_b.jpg:1"]

    # Assert: cm.face_names has an entry for each of the 4 faces
    for face_key in expected_faces:
        assert cm.face_names.get(face_key) == "Ali", (
            f"Expected {face_key} to be recorded as 'Ali' in cm.face_names, got {cm.face_names.get(face_key)}"
        )

    # Assert: all 4 faces are still in a group named "Ali"
    for face_key in expected_faces:
        group = next((g for g in cm.groups if face_key in g.get("member_faces", [])), None)
        assert group is not None, f"Face {face_key} must be in a group"
        assert group.get("display_name") == "Ali", (
            f"Face {face_key} must be in a group named 'Ali', got display_name={group.get('display_name')}"
        )
