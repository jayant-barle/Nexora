"""People data model, validation, group naming, splitting, and merging for Nexora."""

from __future__ import annotations

import collections
import re
from pathlib import Path
from typing import Any
import numpy as np

from nexora.names import WINDOWS_RESERVED_NAMES
from nexora.faces.recognize import cosine_similarity
from nexora.faces.suggestions import (
    MERGE_SUGGEST_THRESHOLD,
    MAX_MERGE_SUGGESTIONS,
    DISMISSAL_OVERLAP_MIN,
    compute_pair_dismissal_key,
    create_dismissal_record,
    is_pair_dismissed,
    find_merge_suggestions,
)

MERGE_GUARD_SMALL_CLUSTER_MAX = 3  # A cluster with <= 3 faces must not absorb a cluster > 2x its size
MERGE_GUARD_MAX_RATIO = 2.0        # Max ratio of absorbed to absorber for small clusters


def validate_person_name(name: str) -> str:
    """Validate a person's display name.
    
    Rules:
    - Cannot be empty or only whitespace.
    - Cannot be longer than 40 characters.
    - Cannot be a Windows reserved name (case-insensitive).
    
    Returns stripped name preserving owner's capitalization.
    Raises ValueError with a clear message on failure.
    """
    if name is None:
        raise ValueError("Name cannot be empty.")
    stripped = name.strip()
    if not stripped:
        raise ValueError("Name cannot be empty.")
    if len(stripped) > 40:
        raise ValueError("Name cannot be longer than 40 characters.")
    if stripped.lower() in WINDOWS_RESERVED_NAMES:
        raise ValueError(f"'{stripped}' is a Windows reserved name.")
    return stripped


def to_folder_name(name: str) -> str:
    """Convert a person's name to a safe folder name.
    
    Uses lowercasing and character rules matching the name rule.
    """
    cleaned = re.sub(r'[\\/*?:"<>|]', "", name.strip())
    folder = cleaned.lower()
    if not folder:
        return "unnamed"
    return folder


MIN_VISIBLE_GROUP_SIZE = 2


class PeopleManager:
    """Manages people naming, merging, splitting, and unnamed group numbering."""

    def __init__(self, cluster_manager: Any) -> None:
        self.cm = cluster_manager

    @property
    def groups(self) -> list[dict]:
        return self.cm.groups

    @property
    def file_groups(self) -> dict[str, list[str]]:
        return self.cm.file_groups

    def get_group_sizes(self) -> dict[str, int]:
        """Compute total face counts for all groups across all files in a single pass."""
        counter: collections.Counter[str] = collections.Counter()
        for gids in self.file_groups.values():
            counter.update(gids)
        return counter

    def get_group_size(self, group_id: str) -> int:
        """Count total faces assigned to this group across all files."""
        count = 0
        for gids in self.file_groups.values():
            count += gids.count(group_id)
        return count

    def get_visible_groups(self, group_sizes: dict[str, int] | None = None) -> list[dict]:
        """Return only groups that contain at least 2 faces (clusters with 1 face are hidden)."""
        if group_sizes is None:
            group_sizes = self.get_group_sizes()
        return [g for g in self.groups if group_sizes.get(g["id"], 0) >= MIN_VISIBLE_GROUP_SIZE]

    def get_unnamed_numbering(self, group_sizes: dict[str, int] | None = None) -> dict[str, str]:
        """Compute 'Unnamed person N' mapping for unnamed groups ordered by group size."""
        if group_sizes is None:
            group_sizes = self.get_group_sizes()

        unnamed_groups: list[tuple[str, int]] = []
        for g in self.groups:
            if not g.get("name") and not g.get("display_name"):
                gid = g["id"]
                size = group_sizes.get(gid, 0)
                unnamed_groups.append((gid, size))

        # Sort by size descending, then group ID ascending for stability
        unnamed_groups.sort(key=lambda item: (-item[1], item[0]))

        numbering: dict[str, str] = {}
        for rank, (gid, _) in enumerate(unnamed_groups, start=1):
            numbering[gid] = f"Unnamed person {rank}"
        return numbering

    def get_group_display_name(self, group_id: str) -> str:
        """Get the display name for a group (either owner's name or 'Unnamed person N')."""
        for g in self.groups:
            if g["id"] == group_id:
                if g.get("display_name"):
                    return g["display_name"]
                if g.get("name"):
                    return g["name"]
                break

        numbering = self.get_unnamed_numbering()
        return numbering.get(group_id, "Unnamed person")

    def filter_groups(self, groups: list[dict], query: str, group_sizes: dict[str, int] | None = None) -> list[dict]:
        """Filter group cards by name or by keywords ('unnamed', 'large group', 'needs review')."""
        q = (query or "").strip().lower()
        if not q:
            return list(groups)

        if group_sizes is None:
            group_sizes = self.get_group_sizes()

        unnamed_numbering = self.get_unnamed_numbering(group_sizes=group_sizes)
        filtered: list[dict] = []

        keyword_unnamed = {"unnamed", "unnamed person", "unnamed group"}
        keyword_large = {"large", "large group", "large groups", "needs review", "needs_review"}

        for g in groups:
            gid = g["id"]
            has_assigned_name = bool((g.get("display_name") or g.get("name") or "").strip())
            display_name = (g.get("display_name") or g.get("name") or "").strip().lower()
            folder_name = (g.get("name") or "").strip().lower()
            is_unnamed = not has_assigned_name
            is_large = bool(g.get("needs_review", False))

            matched = False

            # Name matching: case-insensitive substring of assigned display name or folder name
            if has_assigned_name:
                if q in display_name or q in folder_name:
                    matched = True

            # Keyword matching: whole words or phrases only; single-character queries match names only, not keywords
            if len(q) >= 2:
                if is_unnamed:
                    unnamed_label = unnamed_numbering.get(gid, "").lower()
                    if q in keyword_unnamed or q == unnamed_label:
                        matched = True
                if is_large:
                    if q in keyword_large:
                        matched = True

            if matched:
                filtered.append(g)

        return filtered

    def sort_groups(self, groups: list[dict], sort_by: str = "Largest first", group_sizes: dict[str, int] | None = None) -> list[dict]:
        """Sort groups by: 'Largest first', 'Smallest first', 'Name A-Z', or 'Needs review first'."""
        if group_sizes is None:
            group_sizes = self.get_group_sizes()

        unnamed_numbering = self.get_unnamed_numbering(group_sizes=group_sizes)

        def sort_key(g: dict) -> tuple:
            gid = g["id"]
            size = group_sizes.get(gid, 0)
            display_name = (
                g.get("display_name")
                or g.get("name")
                or unnamed_numbering.get(gid, "Unnamed person")
            ).lower()
            needs_review = bool(g.get("needs_review", False))

            if sort_by == "Smallest first":
                return (size, display_name, gid)
            elif sort_by == "Name A-Z":
                return (display_name, -size, gid)
            elif sort_by == "Needs review first":
                # needs_review=True (0) before needs_review=False (1), then largest first
                return (0 if needs_review else 1, -size, display_name, gid)
            else:  # "Largest first"
                return (-size, display_name, gid)

        return sorted(groups, key=sort_key)

    def name_group(self, group_id: str, raw_name: str) -> str:
        """Assign a name to a group, validating and merging under same name."""
        clean_name = validate_person_name(raw_name)
        folder_name = to_folder_name(clean_name)

        target_group = None
        for g in self.groups:
            if g["id"] == group_id:
                target_group = g
                break

        if target_group is None:
            raise ValueError(f"Group not found: {group_id}")

        target_group["name"] = folder_name
        target_group["display_name"] = clean_name
        target_group["needs_review"] = False

        # Store names by member face in cm.face_names so names survive re-clustering
        if not hasattr(self.cm, "face_names"):
            self.cm.face_names = {}
        for fk, gids in self.file_groups.items():
            for idx, gid in enumerate(gids):
                if gid == group_id:
                    self.cm.face_names[f"{fk}:{idx}"] = clean_name
        if target_group.get("member_faces"):
            for m in target_group["member_faces"]:
                self.cm.face_names[m] = clean_name

        self.cm.save()
        return clean_name

    def split_group(self, group_id: str) -> tuple[str, str]:
        """Split a group into two groups based on face embedding distance.
        
        Requires the group to have at least 2 faces across files or cache.
        Returns (original_group_id, new_group_id).
        """
        target_group = None
        for g in self.groups:
            if g["id"] == group_id:
                target_group = g
                break

        if target_group is None:
            raise ValueError(f"Group not found: {group_id}")

        # Gather all face instances assigned to this group
        # Each face instance: (file_key, face_index, embedding, crop_path_or_box)
        face_instances: list[dict[str, Any]] = []

        for file_key, gids in self.file_groups.items():
            cache_entry = self.cm.cache.get(file_key, {})
            cached_faces = cache_entry.get("faces", [])
            for idx, gid in enumerate(gids):
                if gid == group_id and idx < len(cached_faces):
                    emb = cached_faces[idx].get("embedding")
                    if emb:
                        face_instances.append({
                            "file_key": file_key,
                            "face_index": idx,
                            "embedding": np.array(emb, dtype=np.float32),
                        })

        if len(face_instances) < 2:
            raise ValueError("Cannot split a group with fewer than 2 faces.")

        # Partition embeddings into 2 clusters using furthest pair as seeds
        embs = [inst["embedding"] for inst in face_instances]
        n = len(embs)
        best_dist = -1.0
        seed_a, seed_b = 0, 1
        for i in range(n):
            for j in range(i + 1, n):
                sim = cosine_similarity(embs[i], embs[j])
                dist = 1.0 - sim
                if dist > best_dist:
                    best_dist = dist
                    seed_a, seed_b = i, j

        rep_a = embs[seed_a]
        rep_b = embs[seed_b]

        cluster_a: list[dict[str, Any]] = []
        cluster_b: list[dict[str, Any]] = []

        for inst in face_instances:
            sim_a = cosine_similarity(inst["embedding"], rep_a)
            sim_b = cosine_similarity(inst["embedding"], rep_b)
            if sim_a >= sim_b:
                cluster_a.append(inst)
            else:
                cluster_b.append(inst)

        # Ensure neither cluster is empty
        if not cluster_a:
            cluster_a.append(cluster_b.pop())
        elif not cluster_b:
            cluster_b.append(cluster_a.pop())

        # Create new group ID
        new_gid = f"group_{len(self.groups) + 1:03d}"
        existing_ids = {g["id"] for g in self.groups}
        counter = len(self.groups) + 1
        while new_gid in existing_ids:
            counter += 1
            new_gid = f"group_{counter:03d}"

        # Reassign cluster_b faces to new_gid in file_groups
        for inst in cluster_b:
            file_key = inst["file_key"]
            face_idx = inst["face_index"]
            gids = self.file_groups.get(file_key, [])
            if face_idx < len(gids):
                gids[face_idx] = new_gid

        # Compute new representative embeddings
        mean_a = np.mean([inst["embedding"] for inst in cluster_a], axis=0)
        mean_b = np.mean([inst["embedding"] for inst in cluster_b], axis=0)
        norm_a = np.linalg.norm(mean_a)
        norm_b = np.linalg.norm(mean_b)
        rep_a = (mean_a / norm_a) if norm_a > 0 else mean_a
        rep_b = (mean_b / norm_b) if norm_b > 0 else mean_b

        # Partition member faces
        members_a = [f"{inst['file_key']}:{inst['face_index']}" for inst in cluster_a]
        members_b = [f"{inst['file_key']}:{inst['face_index']}" for inst in cluster_b]

        target_group["representative_embedding"] = [float(x) for x in rep_a]
        target_group["needs_review"] = False
        target_group["member_faces"] = members_a

        # If any cluster_b faces had target_group's name in face_names, remove them
        if hasattr(self.cm, "face_names") and isinstance(self.cm.face_names, dict):
            for m in members_b:
                self.cm.face_names.pop(m, None)

        new_group = {
            "id": new_gid,
            "name": None,
            "display_name": None,
            "crop_path": target_group.get("crop_path", ""),
            "crop_paths": target_group.get("crop_paths", [])[:3],
            "representative_embedding": [float(x) for x in rep_b],
            "member_faces": members_b,
            "needs_review": False,
        }
        self.groups.append(new_group)

        self.cm.save()
        return (group_id, new_gid)

    def would_guard_refuse_merge(self, target_group_id: str, source_group_id: str) -> bool:
        """Check whether the merge size guard would trigger on merging source into target.
        
        Guard: a cluster with 3 or fewer faces must not absorb a cluster
        more than twice its size.
        """
        if target_group_id == source_group_id:
            return False
        target_size = self.get_group_size(target_group_id)
        source_size = self.get_group_size(source_group_id)
        return (
            target_size <= MERGE_GUARD_SMALL_CLUSTER_MAX
            and source_size > MERGE_GUARD_MAX_RATIO * target_size
        )

    def merge_groups(
        self,
        target_group_id: str,
        source_group_id: str,
        is_automatic: bool = False,
    ) -> bool:
        """Merge source_group into target_group.
        
        Guard: a cluster with 3 or fewer faces must not absorb a cluster
        more than twice its size. This guard applies only to automatic merges
        (is_automatic=True). Manual merges from the People screen are allowed.
        Returns False if refused, True if merged.
        """
        if target_group_id == source_group_id:
            return False

        if is_automatic and self.would_guard_refuse_merge(target_group_id, source_group_id):
            return False

        # Reassign in file_groups and track moved face keys
        moved_faces: list[str] = []
        for file_key, gids in self.file_groups.items():
            for idx in range(len(gids)):
                if gids[idx] == source_group_id:
                    gids[idx] = target_group_id
                    f_key = f"{file_key}:{idx}"
                    if f_key not in moved_faces:
                        moved_faces.append(f_key)

        # Combine crops
        target_group = None
        source_idx = None
        for idx, g in enumerate(self.groups):
            if g["id"] == target_group_id:
                target_group = g
            elif g["id"] == source_group_id:
                source_idx = idx

        if target_group is not None and source_idx is not None:
            source_group = self.groups[source_idx]
            for mf in source_group.get("member_faces", []):
                if mf not in moved_faces:
                    moved_faces.append(mf)

            target_members = target_group.setdefault("member_faces", [])
            for mf in moved_faces:
                if mf not in target_members:
                    target_members.append(mf)

            # When merging into a named target, record target name in cm.face_names for moved faces
            target_name = target_group.get("display_name") or target_group.get("name")
            if target_name:
                if not hasattr(self.cm, "face_names"):
                    self.cm.face_names = {}
                for mf in moved_faces:
                    self.cm.face_names[mf] = target_name

            crops = target_group.get("crop_paths", [])
            for c in source_group.get("crop_paths", []):
                if c not in crops:
                    crops.append(c)
            target_group["crop_paths"] = crops[:6]
            self.groups.pop(source_idx)

        self.cm.save()
        return True

    def get_merge_suggestions(
        self, threshold: float = MERGE_SUGGEST_THRESHOLD, max_suggestions: int = MAX_MERGE_SUGGESTIONS
    ) -> tuple[list[dict[str, Any]], int]:
        """Find suggested merges between pairs of visible groups with similarity >= threshold.
        
        Returns (capped_suggestions, total_count).
        """
        unnamed = self.get_unnamed_numbering()
        dismissed = getattr(self.cm, "dismissed_merges", [])
        return find_merge_suggestions(
            groups=self.get_visible_groups(),
            file_groups=self.file_groups,
            dismissed_merges=dismissed,
            threshold=threshold,
            unnamed_numbering=unnamed,
            max_suggestions=max_suggestions,
        )

    def dismiss_merge(self, group_id_a: str, group_id_b: str) -> None:
        """Mark a suggested pair of groups as not the same person so it will not be suggested again."""
        g_a = next((g for g in self.groups if g["id"] == group_id_a), None)
        g_b = next((g for g in self.groups if g["id"] == group_id_b), None)
        if not g_a or not g_b:
            return
        if not hasattr(self.cm, "dismissed_merges") or not isinstance(self.cm.dismissed_merges, list):
            self.cm.dismissed_merges = list(getattr(self.cm, "dismissed_merges", []))

        if is_pair_dismissed(g_a, g_b, self.cm.dismissed_merges, self.file_groups):
            return

        record = create_dismissal_record(g_a, g_b, self.file_groups)
        self.cm.dismissed_merges.append(record)
        self.cm.save()

    def get_face_data_for_plan(self) -> dict[str, dict[str, Any]]:
        """Build face_data dictionary for build_plan.
        
        Treats faces in hidden groups (size < MIN_VISIBLE_GROUP_SIZE) as 'no face'.
        For images:
          {"faces": [person_display_name_or_None, ...]}
        For videos:
          {"video_person": person_display_name_if_matched}
        """
        # Count total faces per named person across all groups sharing that name (case-insensitive)
        person_counts: dict[str, int] = {}
        for g in self.groups:
            folder_name = (g.get("name") or "").strip().lower()
            if folder_name:
                person_counts[folder_name] = person_counts.get(folder_name, 0) + self.get_group_size(g["id"])

        group_person: dict[str, str | None] = {}
        for g in self.groups:
            gid = g["id"]
            pname = g.get("display_name") or g.get("name")
            folder_name = (g.get("name") or "").strip().lower()
            size = self.get_group_size(gid)
            needs_review = g.get("needs_review", False)

            # If marked needs review and not yet named or split by owner, withhold from automatic placement
            if needs_review and not folder_name:
                group_person[gid] = "HIDDEN"
                continue

            if folder_name:
                # Visible if total faces for this named person >= MIN_VISIBLE_GROUP_SIZE
                if person_counts.get(folder_name, 0) >= MIN_VISIBLE_GROUP_SIZE:
                    group_person[gid] = pname
                else:
                    group_person[gid] = "HIDDEN"
            else:
                if size >= MIN_VISIBLE_GROUP_SIZE:
                    group_person[gid] = None  # visible unnamed
                else:
                    group_person[gid] = "HIDDEN"

        face_data: dict[str, dict[str, Any]] = {}

        for file_key, gids in self.file_groups.items():
            cache_entry = self.cm.cache.get(file_key, {})
            is_video = cache_entry.get("type") == "video"

            if is_video:
                # Video: a visible named person counts if appearing in >= 2 of 5 sampled frames
                named_candidates = [
                    group_person[gid] for gid in gids
                    if gid in group_person and group_person[gid] not in (None, "HIDDEN")
                ]
                video_person = named_candidates[0] if named_candidates else None
                face_data[file_key] = {
                    "video_person": video_person,
                }
            else:
                # Image: list of visible person names or None for each visible face; hidden faces omitted
                faces = [
                    group_person[gid] for gid in gids
                    if gid in group_person and group_person[gid] != "HIDDEN"
                ]
                face_data[file_key] = {
                    "faces": faces,
                }

        return face_data

    def get_withheld_photos_report(self) -> dict[str, list[dict[str, Any]]]:
        """Categorize all photos withheld from automatic people placement and explain why.
        
        Returns a dictionary with keys:
          - 'needs_review': Photos in clusters exceeding the review cap that have not been named or split.
          - 'unnamed': Photos in visible clusters (>= 2 faces) that have not been assigned a name.
          - 'hidden_group': Photos in single-face clusters (< 2 faces) withheld until more faces join.
        
        Each item is a dict with:
          'file_key': str,
          'file_name': str,
          'group_id': str,
          'display_name': str,
          'size': int,
          'reason': str,
        """
        person_counts: dict[str, int] = {}
        for g in self.groups:
            folder_name = (g.get("name") or "").strip().lower()
            if folder_name:
                person_counts[folder_name] = person_counts.get(folder_name, 0) + self.get_group_size(g["id"])

        report: dict[str, list[dict[str, Any]]] = {
            "needs_review": [],
            "unnamed": [],
            "hidden_group": [],
        }

        unnamed_numbering = self.get_unnamed_numbering()

        for g in self.groups:
            gid = g["id"]
            folder_name = (g.get("name") or "").strip().lower()
            size = self.get_group_size(gid)
            display_name = g.get("display_name") or g.get("name") or unnamed_numbering.get(gid, "Unnamed person")
            needs_review = g.get("needs_review", False)

            reason_key = None
            reason_text = ""

            if needs_review and not folder_name:
                reason_key = "needs_review"
                reason_text = "Cluster exceeded size cap; needs review or naming before automatic placement"
            elif not folder_name:
                if size < MIN_VISIBLE_GROUP_SIZE:
                    reason_key = "hidden_group"
                    reason_text = f"Hidden single-face cluster ({size} face); withheld until more faces join"
                else:
                    reason_key = "unnamed"
                    reason_text = "Group is unnamed; name it to place photos into a person folder"
            elif person_counts.get(folder_name, 0) < MIN_VISIBLE_GROUP_SIZE:
                reason_key = "hidden_group"
                reason_text = f"Named person has fewer than {MIN_VISIBLE_GROUP_SIZE} faces across library"

            if reason_key:
                # Find all files with faces belonging to this group
                files_in_group = [fk for fk, gids in self.file_groups.items() if gid in gids]
                for fk in sorted(files_in_group):
                    report[reason_key].append({
                        "file_key": fk,
                        "file_name": Path(fk).name,
                        "group_id": gid,
                        "display_name": display_name,
                        "size": size,
                        "reason": reason_text,
                    })

        return report

