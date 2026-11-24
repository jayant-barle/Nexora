"""Tests verifying FaceClusterManager.name_group enforces validation via single naming path (AGENTS.md Rule 4)."""

from pathlib import Path
import pytest

from nexora.faces.groups import FaceClusterManager


def test_face_cluster_manager_name_group_rejects_reserved_and_long_names(tmp_path: Path):
    """FaceClusterManager.name_group must reject invalid names the same way PeopleManager.name_group does."""
    json_path = tmp_path / "faces.json"
    cm = FaceClusterManager(json_path=json_path)
    cm.groups = [
        {"id": "group_001", "name": None, "display_name": None, "needs_review": True}
    ]
    cm.save()

    # Call with a reserved name (e.g. "con")
    with pytest.raises(ValueError, match="reserved"):
        cm.name_group("group_001", "con")

    # Call with a 41-character name
    with pytest.raises(ValueError, match="40"):
        cm.name_group("group_001", "a" * 41)


def test_face_cluster_manager_name_group_clears_needs_review(tmp_path: Path):
    """FaceClusterManager.name_group must clear needs_review on large groups."""
    json_path = tmp_path / "faces.json"
    cm = FaceClusterManager(json_path=json_path)
    cm.groups = [
        {"id": "group_001", "name": None, "display_name": None, "needs_review": True}
    ]
    cm.save()

    cm.name_group("group_001", "Alice")
    assert cm.groups[0]["needs_review"] is False
    assert cm.groups[0]["display_name"] == "Alice"
    assert cm.groups[0]["name"] == "alice"
