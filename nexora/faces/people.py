"""People data model, validation, group naming, splitting, and merging for Nexora."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any
import numpy as np

from nexora.names import WINDOWS_RESERVED_NAMES
from nexora.faces.recognize import cosine_similarity


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

    def get_group_size(self, group_id: str) -> int:
        """Count total faces assigned to this group across all files."""
        count = 0
        for gids in self.file_groups.values():
            count += gids.count(group_id)
        return count

    def get_visible_groups(self) -> list[dict]:
        """Return only groups that contain at least 2 faces (clusters with 1 face are hidden)."""
        return [g for g in self.groups if self.get_group_size(g["id"]) >= MIN_VISIBLE_GROUP_SIZE]

    def get_unnamed_numbering(self) -> dict[str, str]:
        """Compute 'Unnamed person N' mapping for unnamed groups ordered by group size."""
        unnamed_groups: list[tuple[str, int]] = []
        for g in self.groups:
            if not g.get("name") and not g.get("display_name"):
                gid = g["id"]
                size = self.get_group_size(gid)
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

        target_group["representative_embedding"] = [float(x) for x in rep_a]
        target_group["needs_review"] = False

        new_group = {
            "id": new_gid,
            "name": None,
            "display_name": None,
            "crop_path": target_group.get("crop_path", ""),
            "crop_paths": target_group.get("crop_paths", [])[:3],
            "representative_embedding": [float(x) for x in rep_b],
            "needs_review": False,
        }
        self.groups.append(new_group)

        self.cm.save()
        return (group_id, new_gid)

    def merge_groups(self, target_group_id: str, source_group_id: str) -> None:
        """Merge source_group into target_group."""
        if target_group_id == source_group_id:
            return

        # Reassign in file_groups
        for file_key, gids in self.file_groups.items():
            for idx in range(len(gids)):
                if gids[idx] == source_group_id:
                    gids[idx] = target_group_id

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
            crops = target_group.get("crop_paths", [])
            for c in source_group.get("crop_paths", []):
                if c not in crops:
                    crops.append(c)
            target_group["crop_paths"] = crops[:6]
            self.groups.pop(source_idx)

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
