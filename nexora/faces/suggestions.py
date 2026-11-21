"""Group merge suggestion engine and stable dismissal tracking for Nexora."""

from __future__ import annotations

import hashlib
from typing import Any
import numpy as np

from nexora.faces.recognize import cosine_similarity

# Default threshold for suggesting group merges (OpenCV recommended cosine for SFace)
# Unmeasured default, pending owner testing on real labelled library.
MERGE_SUGGEST_THRESHOLD: float = 0.363

# Maximum number of merge suggestions displayed at once
MAX_MERGE_SUGGESTIONS: int = 50

# Minimum member overlap ratio (> 50%) required for a stored dismissal to match a current group.
# Unmeasured default, pending owner testing on real labelled library.
DISMISSAL_OVERLAP_MIN: float = 0.5

# Maximum number of member face IDs stored per group in a dismissal record
MAX_STORED_DISMISSAL_MEMBERS: int = 10


def get_group_member_faces(group: dict[str, Any], file_groups: dict[str, list[str]] | None = None) -> list[str]:
    """Retrieve all member face IDs for a group, sorted deterministically."""
    members: list[str] = []
    if group.get("member_faces"):
        members = list(group["member_faces"])
    elif file_groups:
        gid = group.get("id")
        for fk in sorted(file_groups.keys()):
            for idx, assigned_gid in enumerate(file_groups[fk]):
                if assigned_gid == gid:
                    members.append(f"{fk}:{idx}")
    return sorted(members)


def compute_group_stable_key(group: dict[str, Any], file_groups: dict[str, list[str]] | None = None) -> str:
    """Compute a legacy pair lookup key based on the first 5 member face IDs."""
    members = get_group_member_faces(group, file_groups)
    if members:
        return ",".join(members[:5])
    return str(group.get("id", ""))


def compute_pair_dismissal_key(
    group_a: dict[str, Any],
    group_b: dict[str, Any],
    file_groups: dict[str, list[str]] | None = None,
) -> str:
    """Compute a symmetric, deterministic hash identifying a pair of groups.
    
    Used as a fast lookup key.
    """
    key_a = compute_group_stable_key(group_a, file_groups)
    key_b = compute_group_stable_key(group_b, file_groups)
    pair_str = f"{min(key_a, key_b)}<->{max(key_a, key_b)}"
    return hashlib.sha256(pair_str.encode("utf-8")).hexdigest()


def create_dismissal_record(
    group_a: dict[str, Any],
    group_b: dict[str, Any],
    file_groups: dict[str, list[str]] | None = None,
    max_members: int = MAX_STORED_DISMISSAL_MEMBERS,
) -> dict[str, Any]:
    """Create a dismissal record storing member face IDs (up to 10 per group, sorted) and pair key."""
    key = compute_pair_dismissal_key(group_a, group_b, file_groups)
    members_a = get_group_member_faces(group_a, file_groups)[:max_members]
    members_b = get_group_member_faces(group_b, file_groups)[:max_members]
    return {
        "key": key,
        "members_a": members_a,
        "members_b": members_b,
    }


def is_pair_dismissed(
    group_a: dict[str, Any],
    group_b: dict[str, Any],
    dismissed_merges: list[Any],
    file_groups: dict[str, list[str]] | None = None,
    overlap_min: float = DISMISSAL_OVERLAP_MIN,
) -> bool:
    """Determine whether a current pair of groups counts as dismissed.
    
    Rules:
    - Old-format entries (strings): exact match with current pair_key.
    - New-format entries (dicts):
      - Fast lookup: if stored key matches current pair_key and overlap condition is confirmed.
      - Overlap rule: strictly more than half (> overlap_min) of stored member IDs for group A are still members
        of one current group, AND strictly more than half of stored member IDs for group B are still members of the other current group.
    """
    if not dismissed_merges:
        return False

    current_pair_key = compute_pair_dismissal_key(group_a, group_b, file_groups)
    current_members_a = set(get_group_member_faces(group_a, file_groups))
    current_members_b = set(get_group_member_faces(group_b, file_groups))

    for entry in dismissed_merges:
        if isinstance(entry, str):
            # Old-format exact key match
            if entry == current_pair_key:
                return True
        elif isinstance(entry, dict):
            stored_a = set(entry.get("members_a", []))
            stored_b = set(entry.get("members_b", []))

            if not stored_a or not stored_b:
                if entry.get("key") == current_pair_key:
                    return True
                continue

            # Check overlap rule in both group orientations:
            # Orientation 1: stored_a with current_members_a, stored_b with current_members_b
            overlap_a1 = len(stored_a & current_members_a) / len(stored_a)
            overlap_b2 = len(stored_b & current_members_b) / len(stored_b)
            if overlap_a1 > overlap_min and overlap_b2 > overlap_min:
                return True

            # Orientation 2: stored_a with current_members_b, stored_b with current_members_a
            overlap_a2 = len(stored_a & current_members_b) / len(stored_a)
            overlap_b1 = len(stored_b & current_members_a) / len(stored_b)
            if overlap_a2 > overlap_min and overlap_b1 > overlap_min:
                return True

    return False


def find_merge_suggestions(
    groups: list[dict[str, Any]],
    file_groups: dict[str, list[str]],
    dismissed_merges: list[Any],
    threshold: float = MERGE_SUGGEST_THRESHOLD,
    unnamed_numbering: dict[str, str] | None = None,
    max_suggestions: int = MAX_MERGE_SUGGESTIONS,
    overlap_min: float = DISMISSAL_OVERLAP_MIN,
) -> tuple[list[dict[str, Any]], int]:
    """Find pairs of visible groups with similarity >= threshold.
    
    Rules:
    - Never suggests a pair already having the same name (case-insensitive).
    - Never suggests a pair that has been dismissed (evaluated via overlap rule).
    - Suggestions are sorted by cosine similarity descending.
    - Capped at max_suggestions (default 50).
    
    Returns:
        (capped_suggestions, total_count)
    """
    all_suggestions: list[dict[str, Any]] = []
    n = len(groups)

    for i in range(n):
        for j in range(i + 1, n):
            g_a = groups[i]
            g_b = groups[j]

            # Check if both already have the same assigned name
            name_a = (g_a.get("display_name") or g_a.get("name") or "").strip().lower()
            name_b = (g_b.get("display_name") or g_b.get("name") or "").strip().lower()
            if name_a and name_b and name_a == name_b:
                continue

            # Check if pair has been dismissed by the owner (via overlap rule)
            if is_pair_dismissed(g_a, g_b, dismissed_merges, file_groups, overlap_min=overlap_min):
                continue

            # Compute cosine similarity between representative embeddings
            rep_a = np.array(g_a.get("representative_embedding", []), dtype=np.float32)
            rep_b = np.array(g_b.get("representative_embedding", []), dtype=np.float32)
            if rep_a.size == 0 or rep_b.size == 0:
                continue

            raw_sim = float(cosine_similarity(rep_a, rep_b))
            sim = max(0.0, min(1.0, raw_sim))
            if sim < threshold:
                continue

            gid_a = g_a.get("id", "")
            gid_b = g_b.get("id", "")

            # Count photos containing each group
            photos_a = sum(1 for gids in file_groups.values() if gid_a in gids)
            photos_b = sum(1 for gids in file_groups.values() if gid_b in gids)

            disp_a = (
                g_a.get("display_name")
                or g_a.get("name")
                or (unnamed_numbering.get(gid_a) if unnamed_numbering else None)
                or "Unnamed person"
            )
            disp_b = (
                g_b.get("display_name")
                or g_b.get("name")
                or (unnamed_numbering.get(gid_b) if unnamed_numbering else None)
                or "Unnamed person"
            )

            crop_a_paths = g_a.get("crop_paths", [])
            crop_a = crop_a_paths[0] if crop_a_paths else (g_a.get("crop_path") or "")

            crop_b_paths = g_b.get("crop_paths", [])
            crop_b = crop_b_paths[0] if crop_b_paths else (g_b.get("crop_path") or "")

            pair_key = compute_pair_dismissal_key(g_a, g_b, file_groups)

            all_suggestions.append({
                "group_a": g_a,
                "group_b": g_b,
                "group_a_id": gid_a,
                "group_b_id": gid_b,
                "group_a_name": disp_a,
                "group_b_name": disp_b,
                "group_a_photos": photos_a,
                "group_b_photos": photos_b,
                "group_a_crop": crop_a,
                "group_b_crop": crop_b,
                "similarity": sim,
                "pair_key": pair_key,
            })

    # Sort descending by similarity, tie-breaking on group IDs
    all_suggestions.sort(key=lambda s: (-s["similarity"], s["group_a_id"], s["group_b_id"]))
    total_count = len(all_suggestions)
    capped_suggestions = all_suggestions[:max_suggestions]

    return capped_suggestions, total_count
