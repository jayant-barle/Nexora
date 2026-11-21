"""Tests for people data model: naming, merging, splitting, validation, and unnamed numbering."""

import pytest
from pathlib import Path

from nexora.faces.groups import FaceClusterManager
from nexora.faces.people import PeopleManager, validate_person_name, to_folder_name


def test_naming_a_group(tmp_path: Path):
    """Naming a group validates name, preserves display case, and sets safe folder name."""
    json_path = tmp_path / "runs" / "faces.json"
    cm = FaceClusterManager(json_path=json_path)
    cm.groups = [
        {"id": "group_001", "name": None, "representative_embedding": [1.0] + [0.0] * 127}
    ]
    pm = PeopleManager(cm)

    saved = pm.name_group("group_001", "Alice Smith")
    assert saved == "Alice Smith"
    assert cm.groups[0]["name"] == "alice smith"
    assert cm.groups[0]["display_name"] == "Alice Smith"
    assert pm.get_group_display_name("group_001") == "Alice Smith"


def test_merging_two_groups_under_one_name(tmp_path: Path):
    """Giving two groups the same name merges them for the same person."""
    json_path = tmp_path / "runs" / "faces.json"
    cm = FaceClusterManager(json_path=json_path)
    cm.groups = [
        {"id": "group_001", "name": None, "representative_embedding": [1.0] + [0.0] * 127},
        {"id": "group_002", "name": None, "representative_embedding": [0.0, 1.0] + [0.0] * 126},
    ]
    cm.file_groups = {
        "file1.jpg": ["group_001"],
        "file2.jpg": ["group_002"],
    }
    pm = PeopleManager(cm)

    pm.name_group("group_001", "Bob")
    pm.name_group("group_002", "bob")

    assert cm.groups[0]["name"] == "bob"
    assert cm.groups[1]["name"] == "bob"

    face_data = pm.get_face_data_for_plan()
    assert face_data["file1.jpg"]["faces"] == ["Bob"]
    assert face_data["file2.jpg"]["faces"] == ["bob"]


def test_splitting_a_group(tmp_path: Path):
    """Splitting divides one group into two groups and updates faces.json."""
    json_path = tmp_path / "runs" / "faces.json"
    cm = FaceClusterManager(json_path=json_path)
    cm.groups = [
        {"id": "group_001", "name": None, "representative_embedding": [1.0] + [0.0] * 127}
    ]
    # 2 faces in cache with opposite embeddings
    emb1 = [1.0] + [0.0] * 127
    emb2 = [-1.0] + [0.0] * 127

    cm.cache = {
        "img1.jpg": {"size": 100, "sha256": "aaa", "faces": [{"embedding": emb1}]},
        "img2.jpg": {"size": 200, "sha256": "bbb", "faces": [{"embedding": emb2}]},
    }
    cm.file_groups = {
        "img1.jpg": ["group_001"],
        "img2.jpg": ["group_001"],
    }
    pm = PeopleManager(cm)

    orig_id, new_id = pm.split_group("group_001")
    assert orig_id == "group_001"
    assert new_id != "group_001"
    assert len(cm.groups) == 2

    # Faces repartitioned
    assert cm.file_groups["img1.jpg"] == ["group_001"]
    assert cm.file_groups["img2.jpg"] == [new_id]

    # Stored in json
    assert json_path.exists()
    cm2 = FaceClusterManager(json_path=json_path)
    assert len(cm2.groups) == 2


def test_reject_reserved_name():
    """Reserved Windows device names are rejected with clear messages."""
    for bad in ["con", "CON", "prn", "aux", "nul", "com1", "com9", "lpt1", "lpt8"]:
        with pytest.raises(ValueError, match="Windows reserved name"):
            validate_person_name(bad)


def test_reject_name_over_40_characters():
    """Names longer than 40 characters are rejected."""
    long_name = "A" * 41
    with pytest.raises(ValueError, match="cannot be longer than 40 characters"):
        validate_person_name(long_name)

    # 40 characters is allowed
    assert validate_person_name("A" * 40) == "A" * 40


def test_reject_empty_name():
    """Empty or whitespace-only names are rejected."""
    with pytest.raises(ValueError, match="cannot be empty"):
        validate_person_name("")
    with pytest.raises(ValueError, match="cannot be empty"):
        validate_person_name("   \t  ")


def test_unnamed_numbering(tmp_path: Path):
    """Unnamed groups are displayed as 'Unnamed person N' ordered by group size."""
    json_path = tmp_path / "runs" / "faces.json"
    cm = FaceClusterManager(json_path=json_path)
    cm.groups = [
        {"id": "group_001", "name": None, "representative_embedding": []},
        {"id": "group_002", "name": None, "representative_embedding": []},
        {"id": "group_003", "name": None, "representative_embedding": []},
    ]
    # group_002 has 3 faces, group_001 has 2 faces, group_003 has 1 face
    cm.file_groups = {
        "f1.jpg": ["group_002", "group_001"],
        "f2.jpg": ["group_002", "group_002"],
        "f3.jpg": ["group_001", "group_003"],
    }
    pm = PeopleManager(cm)
    numbering = pm.get_unnamed_numbering()

    assert numbering["group_002"] == "Unnamed person 1"
    assert numbering["group_001"] == "Unnamed person 2"
    assert numbering["group_003"] == "Unnamed person 3"
