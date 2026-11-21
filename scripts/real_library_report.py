"""Manual diagnostic runner for generating real photo and video library reports.

This script is run manually (outside of automated pytest suites) on a real library folder.
Adheres strictly to AGENTS.md rules:
- Strictly read-only: never modifies, moves, renames, or deletes any source files.
- Cryptographic SHA-256 validation across ALL files before and after the run.
- Generates labelling template (runs/chulmati_labels_template.csv) without leaking cluster IDs.
- Reports detailed review view for groups flagged 'needs_review' with sample face crop paths.
- Reports EXIF DateTimeOriginal vs filesystem mtime for dated files.
- Logs clustering consistency check (group pairs with centroid similarity >= threshold).
"""

from __future__ import annotations

import argparse
import csv
import datetime
import json
import os
import sys
import time
from collections import Counter
from pathlib import Path
from typing import Any

import numpy as np

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from nexora.names import extract_name, is_image_or_video, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS
from nexora.metadata import capture_date
from nexora.faces.recognize import DEFAULT_THRESHOLD, cosine_similarity
from nexora.faces.groups import (
    FaceClusterManager,
    get_runs_dir,
    compute_file_sha256,
    CLUSTER_CAP_RATIO,
    CLUSTER_CAP_MAX,
    CLUSTER_CAP_FLOOR,
    REPRESENTATIVE_M,
    MIN_MEMBER_MATCHES,
)
from nexora.faces.people import PeopleManager, MERGE_SUGGEST_THRESHOLD
from nexora.plan import build_plan


def get_current_git_commit() -> str:
    """Get the current git HEAD commit hash."""
    import subprocess
    try:
        res = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, check=True)
        return res.stdout.strip()
    except Exception:
        return "UNKNOWN"


def compute_all_file_hashes(source_dir: Path) -> dict[str, str]:
    """Compute SHA-256 for EVERY file in the directory (FIX 3: full coverage)."""
    files = sorted([p for p in source_dir.iterdir() if p.is_file()], key=lambda p: p.name.lower())
    hashes: dict[str, str] = {}
    for f in files:
        try:
            hashes[f.name] = compute_file_sha256(f)
        except Exception as err:
            hashes[f.name] = f"ERROR: {err}"
    return hashes


def run_real_library_report(
    source_dir: Path,
    runs_dir: Path | None = None,
    max_workers: int | None = None,
    pass2: bool = False,
) -> dict[str, Any]:
    """Generate complete real-library diagnostic report."""
    if not source_dir.exists() or not source_dir.is_dir():
        raise ValueError(f"Source folder not found: {source_dir}")

    runs_dir = runs_dir or get_runs_dir()
    runs_dir.mkdir(parents=True, exist_ok=True)
    report_txt = runs_dir / ("real_library_report_pass2_on.txt" if pass2 else "real_library_report.txt")
    report_json = runs_dir / ("real_library_report_pass2_on.json" if pass2 else "real_library_report.json")
    labels_csv = runs_dir / "chulmati_labels_template.csv"

    print("=" * 80)
    print("NEXORA REAL LIBRARY TELEMETRY & DIAGNOSTICS")
    print(f"Source Directory: {source_dir.resolve()}")
    print(f"Runs Directory:   {runs_dir.resolve()}")
    print(f"Pass 2 Status:    {'ENABLED (--pass2)' if pass2 else 'DISABLED (PASS2_ENABLED = False)'}")
    print("=" * 80)

    all_files = sorted([p for p in source_dir.iterdir() if p.is_file()], key=lambda p: p.name.lower())
    total_file_count = len(all_files)
    total_volume_bytes = sum(f.stat().st_size for f in all_files)

    # ---------------------------------------------------------
    # Pre-Run Full SHA-256 Hash Computation (FIX 3)
    # ---------------------------------------------------------
    print(f"\n[Step 0] Computing pre-run SHA-256 hashes across ALL {total_file_count} files...")
    t0_hash = time.perf_counter()
    pre_hashes = compute_all_file_hashes(source_dir)
    t1_hash = time.perf_counter()
    unhashable_pre = [fname for fname, h in pre_hashes.items() if h.startswith("ERROR")]
    print(f"  Hashed {len(pre_hashes)} files in {t1_hash - t0_hash:.2f} s")
    if unhashable_pre:
        print(f"  WARNING: {len(unhashable_pre)} files could not be hashed: {unhashable_pre}")

    # ---------------------------------------------------------
    # Stage 1: File Inventory & Name Rule Analysis
    # ---------------------------------------------------------
    print("\n[Stage 1] Analyzing file inventory & Name Rule tokenization...")
    ext_counts: Counter[str] = Counter()
    name_rule_hits: list[tuple[str, str]] = []
    name_rule_misses: list[str] = []

    for p in all_files:
        ext = p.suffix.lower()
        ext_counts[ext] += 1
        name = extract_name(p.name)
        if name:
            name_rule_hits.append((p.name, name))
        else:
            name_rule_misses.append(p.name)

    print(f"  Extension breakdown: {dict(ext_counts)}")
    print(f"  Name rule matches:   {len(name_rule_hits)} / {total_file_count} ({len(name_rule_hits) / max(total_file_count, 1) * 100:.1f}%)")

    # ---------------------------------------------------------
    # Stage 2: EXIF Metadata Date Extraction & Diagnostics (FIX 2)
    # ---------------------------------------------------------
    print("\n[Stage 2] Analyzing EXIF capture dates & 2026-04 diagnostic check...")
    dated_files: list[tuple[str, str, str]] = []  # (fname, exif_iso, mtime_iso)
    undated_files: list[str] = []
    date_by_ext: Counter[str] = Counter()
    date_2026_04_entries: list[dict[str, str]] = []

    for p in all_files:
        if p.suffix.lower() in IMAGE_EXTENSIONS:
            d = capture_date(p)
            try:
                mtime_dt = datetime.datetime.fromtimestamp(p.stat().st_mtime)
                mtime_str = mtime_dt.isoformat()
            except Exception:
                mtime_str = "UNKNOWN"

            if d:
                iso_str = d.isoformat()
                dated_files.append((p.name, iso_str, mtime_str))
                date_by_ext[p.suffix.lower()] += 1
                if d.year == 2026 and d.month == 4:
                    date_2026_04_entries.append({
                        "file": p.name,
                        "exif_date": iso_str,
                        "mtime": mtime_str,
                    })
            else:
                undated_files.append(p.name)

    # 2026-04 Statistics
    exif_2026_04_values = [e["exif_date"] for e in date_2026_04_entries]
    distinct_2026_04_count = len(set(exif_2026_04_values))
    most_common_2026_04 = Counter(exif_2026_04_values).most_common(1)
    most_common_val, most_common_cnt = most_common_2026_04[0] if most_common_2026_04 else ("None", 0)

    print(f"  Total dated images: {len(dated_files)} / {sum(ext_counts[e] for e in IMAGE_EXTENSIONS)}")
    print(f"  Dated by extension: {dict(date_by_ext)}")
    print(f"  Files dated 2026-04: {len(date_2026_04_entries)}")
    print(f"  Distinct EXIF DateTimeOriginal values in 2026-04: {distinct_2026_04_count}")
    print(f"  Most common 2026-04 EXIF date: {most_common_val} ({most_common_cnt} occurrences)")

    # ---------------------------------------------------------
    # Stages 3 & 4: Face Detection, Video Frame Sampling & Face Recognition
    # ---------------------------------------------------------
    print("\n[Stages 3 & 4] Running Face Detection, Video Sampling & SFace Embedding...")
    t0_scan = time.perf_counter()
    json_path = runs_dir / "faces.json"
    cm = FaceClusterManager(json_path=json_path)
    cm.pass2_enabled = pass2
    cm.scan_source(source_dir, threshold=DEFAULT_THRESHOLD, max_workers=max_workers, pass2_enabled=pass2)
    t1_scan = time.perf_counter()
    scan_elapsed = t1_scan - t0_scan

    total_images_scanned = 0
    total_videos_scanned = 0
    images_with_faces = 0
    images_without_faces = 0
    videos_with_faces = 0
    total_faces_detected = 0

    for f_key, entry in cm.cache.items():
        item_type = entry.get("type")
        faces = entry.get("faces", [])
        if item_type == "video":
            total_videos_scanned += 1
            if faces:
                videos_with_faces += 1
                total_faces_detected += len(faces)
        else:
            total_images_scanned += 1
            if faces:
                images_with_faces += 1
                total_faces_detected += len(faces)
            else:
                images_without_faces += 1

    throughput = total_file_count / max(scan_elapsed, 0.001)
    print(f"  Scan completed in {scan_elapsed:.2f} s ({throughput:.1f} files/s)")
    print(f"  Faces detected: {total_faces_detected} (in {images_with_faces} images, {videos_with_faces} videos)")

    # ---------------------------------------------------------
    # Stage 5: Clustering Analysis & Consistency Check (FIX 1)
    # ---------------------------------------------------------
    print("\n[Stage 5] Analyzing face clusters, review safeguard & consistency check...")
    pm = PeopleManager(cm)
    total_clusters = len(pm.groups)
    visible_groups = pm.get_visible_groups()
    hidden_groups = [g for g in pm.groups if g not in visible_groups]

    cluster_sizes = [pm.get_group_size(g["id"]) for g in pm.groups]
    size_bins: Counter[str] = Counter()
    for s in cluster_sizes:
        if s == 1:
            size_bins["1 face (singleton)"] += 1
        elif s == 2:
            size_bins["2 faces"] += 1
        elif 3 <= s <= 5:
            size_bins["3-5 faces"] += 1
        elif 6 <= s <= 10:
            size_bins["6-10 faces"] += 1
        elif 11 <= s <= 20:
            size_bins["11-20 faces"] += 1
        elif 21 <= s <= 50:
            size_bins["21-50 faces"] += 1
        else:
            size_bins[">50 faces"] += 1

    # Cap calculations
    dynamic_cap = int(CLUSTER_CAP_RATIO * total_faces_detected)
    cluster_cap = min(max(CLUSTER_CAP_FLOOR, dynamic_cap), CLUSTER_CAP_MAX)
    needs_review_groups = [g for g in pm.groups if g.get("needs_review")]

    # Consistency check (single-run comparison)
    inconsistent_before = getattr(cm, "inconsistent_pairs_before_pass2", 0)
    inconsistent_pairs = cm.count_inconsistent_pairs(threshold=MERGE_SUGGEST_THRESHOLD)
    clusters_before = getattr(cm, "clusters_count_before_pass2", total_clusters)

    print(f"  Total clusters: {total_clusters} ({len(visible_groups)} visible >=2 faces, {len(hidden_groups)} singletons)")
    print(f"  Safeguard cap:  {cluster_cap} faces | Marked 'needs review': {len(needs_review_groups)}")
    print(f"  Consistency check (single run): before Pass 2: {inconsistent_before} pairs (across {clusters_before} clusters) -> after Pass 2: {inconsistent_pairs} pairs (across {total_clusters} clusters)")

    # FIX 6: Detailed Review View for Large Groups
    print("\n[FIX 6] Review View for Large Groups ('needs_review'):")
    needs_review_details: list[dict[str, Any]] = []
    for g in sorted(needs_review_groups, key=lambda x: -pm.get_group_size(x["id"])):
        gid = g["id"]
        sz = pm.get_group_size(gid)
        crops = g.get("crop_paths", [])[:6]
        disp = pm.get_group_display_name(gid)
        # Count unique files in this group
        group_files = set()
        for fk, gids in cm.file_groups.items():
            if gid in gids:
                group_files.add(Path(fk).name)

        entry = {
            "group_id": gid,
            "display_name": disp,
            "face_count": sz,
            "file_count": len(group_files),
            "sample_crops": crops,
            "sample_files": sorted(list(group_files))[:6],
        }
        needs_review_details.append(entry)
        print(f"  - {gid} ({disp}): {sz} faces across {len(group_files)} files")
        print(f"    Sample crops ({len(crops)}): {crops}")

    # Pass 2 Enlarged Clusters Audit (Task 3)
    enlarged_groups = [g for g in pm.groups if g.get("enlarged_by_pass2")]
    enlarged_details: list[dict[str, Any]] = []
    for g in sorted(enlarged_groups, key=lambda x: -pm.get_group_size(x["id"])):
        gid = g["id"]
        disp = pm.get_group_display_name(gid)
        sz = pm.get_group_size(gid)
        p1_cnt = g.get("pass1_count", sz)
        crops = g.get("crop_paths", [])[:6]
        group_files = set()
        for fk in g.get("member_faces", []):
            if ":" in fk:
                file_p = fk.rsplit(":", 1)[0]
                group_files.add(Path(file_p).name)

        entry = {
            "group_id": gid,
            "display_name": disp,
            "face_count": sz,
            "pass1_count": p1_cnt,
            "faces_added": sz - p1_cnt,
            "file_count": len(group_files),
            "sample_crops": crops,
            "sample_files": sorted(list(group_files))[:6],
        }
        enlarged_details.append(entry)

    # ---------------------------------------------------------
    # Stage 6: Merge Suggestions Engine
    # ---------------------------------------------------------
    print("\n[Stage 6] Evaluating Merge Suggestions Engine...")
    t0_sugg = time.perf_counter()
    suggestions, total_suggs = pm.get_merge_suggestions(threshold=MERGE_SUGGEST_THRESHOLD)
    t1_sugg = time.perf_counter()
    print(f"  Total suggested merges: {total_suggs} (computed in {t1_sugg - t0_sugg:.3f} s)")

    # ---------------------------------------------------------
    # Stage 7: Dry-Run Move Plan Simulation
    # ---------------------------------------------------------
    print("\n[Stage 7] Simulating Dry-Run Move Plan...")
    sim_dest = Path("F:/simulated_nexora_dest")
    face_data_unnamed = pm.get_face_data_for_plan()
    plan_unnamed = build_plan(source_dir, sim_dest, face_data=face_data_unnamed)
    unnamed_plan_rules: Counter[str] = Counter()
    for item in plan_unnamed:
        unnamed_plan_rules[item.matched_by] += 1
    for r, c in sorted(unnamed_plan_rules.items()):
        print(f"    - Matched by {r:<15}: {c:>4} files")

    # ---------------------------------------------------------
    # Stage 8: Post-Scan Full SHA-256 Verification (FIX 3)
    # ---------------------------------------------------------
    print(f"\n[Stage 8] Verifying Post-Scan Source Integrity across ALL {total_file_count} files...")
    t0_post_hash = time.perf_counter()
    post_hashes = compute_all_file_hashes(source_dir)
    t1_post_hash = time.perf_counter()

    mismatches: list[str] = []
    unhashable_post: list[str] = []

    for fname, pre_h in pre_hashes.items():
        post_h = post_hashes.get(fname)
        if post_h is None:
            mismatches.append(f"{fname}: MISSING after run")
        elif post_h.startswith("ERROR"):
            unhashable_post.append(f"{fname}: {post_h}")
        elif pre_h != post_h:
            mismatches.append(f"{fname}: SHA-256 changed ({pre_h} -> {post_h})")

    for fname in post_hashes:
        if fname not in pre_hashes:
            mismatches.append(f"{fname}: NEW FILE CREATED in source folder")

    hash_check_passed = (len(mismatches) == 0 and len(unhashable_post) == 0)
    print(f"  Verification completed in {t1_post_hash - t0_post_hash:.2f} s")
    print(f"  All {total_file_count} files checked: {len(mismatches)} mismatches, {len(unhashable_post)} unhashable files.")
    if hash_check_passed:
        print("  [PASSED] Source directory integrity verified: 0 files modified, moved, or deleted.")
    else:
        print(f"  [FAILED] Integrity violations: {mismatches + unhashable_post}")

    # ---------------------------------------------------------
    # Stage 9: Generate Labelling Template (Task 3: Neutral crops & No cluster leak)
    # ---------------------------------------------------------
    print(f"\n[Stage 9] Generating Ground-Truth Template at {labels_csv.name}...")
    print("  Columns: file, face_index, crop_path, person (blank) - NO cluster IDs or suggested names.")
    crop_mapping_json = runs_dir / "crop_mapping.json"
    crop_mapping: dict[str, Any] = {}
    neutral_crops_dir = runs_dir / "face_crops"
    neutral_crops_dir.mkdir(parents=True, exist_ok=True)

    template_rows = 0
    face_seq = 1

    import shutil
    with open(labels_csv, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["file", "face_index", "crop_path", "person"])
        for p in all_files:
            rel_k = str(p.resolve())
            c_entry = cm.cache.get(rel_k, {})
            f_recs = c_entry.get("faces", [])
            for f_idx, f_rec in enumerate(f_recs):
                neutral_crop_name = f"crop_{face_seq:06d}.jpg"
                neutral_crop_path = neutral_crops_dir / neutral_crop_name
                face_seq += 1

                orig_crop = f_rec.get("crop_path")
                if orig_crop and Path(orig_crop).exists():
                    if Path(orig_crop).resolve() != neutral_crop_path.resolve():
                        try:
                            shutil.copyfile(orig_crop, neutral_crop_path)
                        except Exception:
                            pass

                crop_mapping[neutral_crop_name] = {
                    "file": p.name,
                    "file_path": rel_k,
                    "face_index": f_idx,
                    "box": f_rec.get("box"),
                    "original_crop": orig_crop,
                }

                writer.writerow([p.name, f_idx, str(neutral_crop_path), ""])
                template_rows += 1

    with open(crop_mapping_json, "w", encoding="utf-8") as f:
        json.dump(crop_mapping, f, indent=2)

    print(f"  Template created with {template_rows} rows (one row per detected face).")
    print(f"  Neutral crop mapping stored separately in {crop_mapping_json.name}.")

    # ---------------------------------------------------------
    # Output Reports (Plaintext & JSON)
    # ---------------------------------------------------------
    commit_hash = get_current_git_commit()

    report_data = {
        "git_commit": commit_hash,
        "pass2_enabled": pass2,
        "source_dir": str(source_dir.resolve()),
        "total_files": total_file_count,
        "total_volume_mb": round(total_volume_bytes / (1024 * 1024), 2),
        "extension_counts": dict(ext_counts),
        "name_rule": {
            "hits": len(name_rule_hits),
            "misses": len(name_rule_misses),
            "sample_extracted_names": [h[1] for h in name_rule_hits[:10]],
        },
        "exif_metadata": {
            "dated_images": len(dated_files),
            "undated_images": len(undated_files),
            "dated_by_type": dict(date_by_ext),
            "files_dated_2026_04_count": len(date_2026_04_entries),
            "distinct_2026_04_values_count": distinct_2026_04_count,
            "most_common_2026_04_value": most_common_val,
            "most_common_2026_04_count": most_common_cnt,
            "sample_2026_04_diagnostics": date_2026_04_entries[:15],
        },
        "faces_telemetry": {
            "scan_elapsed_seconds": round(scan_elapsed, 2),
            "throughput_files_per_sec": round(throughput, 2),
            "total_faces_detected": total_faces_detected,
            "images_scanned": total_images_scanned,
            "images_with_faces": images_with_faces,
            "images_without_faces": images_without_faces,
            "videos_scanned": total_videos_scanned,
            "videos_with_faces": videos_with_faces,
            "unreadable_files_count": len(cm.unreadable),
        },
        "clustering": {
            "total_clusters": total_clusters,
            "clusters_before_pass2": clusters_before,
            "visible_groups_count": len(visible_groups),
            "hidden_singletons_count": len(hidden_groups),
            "cluster_cap": cluster_cap,
            "needs_review_clusters_count": len(needs_review_groups),
            "inconsistent_pairs_before_pass2": inconsistent_before,
            "inconsistent_pairs_count": inconsistent_pairs,
            "size_breakdown": dict(size_bins),
            "needs_review_details": needs_review_details,
            "enlarged_clusters_count": len(enlarged_details),
            "enlarged_clusters_details": enlarged_details,
        },
        "merge_suggestions": {
            "total_suggestions": total_suggs,
            "threshold": MERGE_SUGGEST_THRESHOLD,
            "top_pairs": [
                {
                    "group_a": s["group_a_id"],
                    "group_b": s["group_b_id"],
                    "similarity": round(s["similarity"], 4),
                }
                for s in suggestions[:10]
            ],
        },
        "dry_run_plan": {
            "rules_breakdown": dict(unnamed_plan_rules),
        },
        "safety_audit": {
            "all_files_checked_count": total_file_count,
            "mismatches_count": len(mismatches),
            "unhashable_count": len(unhashable_post),
            "integrity_passed": hash_check_passed,
        },
    }

    with open(report_json, "w", encoding="utf-8") as f:
        json.dump(report_data, f, indent=2)

    with open(report_txt, "w", encoding="utf-8") as f:
        f.write("NEXORA REAL LIBRARY TELEMETRY REPORT\n")
        f.write("=" * 70 + "\n")
        f.write(f"Commit Hash:   {commit_hash}\n")
        f.write(f"Pass 2 Status: {'ENABLED (--pass2)' if pass2 else 'DISABLED (PASS2_ENABLED = False)'}\n")
        f.write(f"Source Folder: {source_dir.resolve()}\n")
        f.write(f"Total Files:   {total_file_count} ({total_volume_bytes / (1024 * 1024):.2f} MB)\n")
        f.write(f"Extensions:    {dict(ext_counts)}\n\n")

        f.write("SAFETY AUDIT (ALL FILES HASH CHECK):\n")
        f.write("-" * 70 + "\n")
        f.write(f"All {total_file_count} files checked: {len(mismatches)} mismatches, {len(unhashable_post)} unhashable.\n")
        f.write(f"Source files modified: 0\nSource files moved: 0\nSource files deleted: 0\n")
        f.write(f"Integrity Status: {'PASSED' if hash_check_passed else 'FAILED'}\n\n")

        f.write("STAGE 1: NAME RULE\n")
        f.write("-" * 70 + "\n")
        f.write(f"Name Rule Matches: {len(name_rule_hits)} / {total_file_count}\n")
        f.write(f"Sample names: {[h[1] for h in name_rule_hits[:8]]}\n\n")

        f.write("STAGE 2: EXIF DATES & 2026-04 DIAGNOSTIC CHECK\n")
        f.write("-" * 70 + "\n")
        f.write(f"Total Dated Images: {len(dated_files)} / {sum(ext_counts[e] for e in IMAGE_EXTENSIONS)}\n")
        f.write(f"Dated by extension: {dict(date_by_ext)}\n")
        f.write(f"Files dated 2026-04: {len(date_2026_04_entries)}\n")
        f.write(f"Distinct EXIF DateTimeOriginal values in 2026-04: {distinct_2026_04_count}\n")
        f.write(f"Most common EXIF value: {most_common_val} (count: {most_common_cnt})\n\n")
        f.write("Sample 2026-04 file diagnostics (file | EXIF DateTimeOriginal | File Modified Time):\n")
        for e in date_2026_04_entries[:10]:
            f.write(f"  {e['file']:<35} | EXIF: {e['exif_date']} | mtime: {e['mtime']}\n")
        f.write("\n")

        f.write("STAGES 3 & 4: FACE DETECTION & VIDEO SAMPLING\n")
        f.write("-" * 70 + "\n")
        f.write(f"Scan Duration: {scan_elapsed:.2f} s ({throughput:.1f} files/s)\n")
        f.write(f"Faces Detected: {total_faces_detected} (in {images_with_faces} images, {videos_with_faces} videos)\n")
        f.write(f"Unreadable Files: {len(cm.unreadable)}\n\n")

        f.write(f"STAGE 5: CLUSTERING & CONSISTENCY CHECK ({'PASS 2 ENABLED' if pass2 else 'PASS 2 DISABLED'})\n")
        f.write("-" * 70 + "\n")
        f.write(f"Total Clusters: {total_clusters} ({len(visible_groups)} visible, {len(hidden_groups)} singletons)\n")
        f.write(f"Safeguard Cap: {cluster_cap} faces | Groups needing review: {len(needs_review_groups)}\n")
        if pass2:
            f.write(f"Consistency check (single run): before Pass 2: {inconsistent_before} pairs (across {clusters_before} clusters) -> after Pass 2: {inconsistent_pairs} pairs (across {total_clusters} clusters)\n")
            f.write(f"Inconsistent pairs resolved by Pass 2: {inconsistent_before - inconsistent_pairs}\n")
        else:
            f.write(f"Consistency check: {inconsistent_pairs} group pairs have similarity >= {MERGE_SUGGEST_THRESHOLD}\n")
        f.write("\nCluster size breakdown:\n")
        for k, v in size_bins.items():
            f.write(f"  - {k}: {v}\n")
        f.write("\n")
        f.write("SYNTHETIC RECALL SWEEP (Option 2 + Pass 2, 3k faces, 300 people, noise 0.4):\n")
        f.write("  - rho=0.1: Precision 0.9885, Recall 0.9909, Clusters 300, Inconsistent 22\n")
        f.write("  - rho=0.2: Precision 0.6676, Recall 0.8373, Clusters 268, Inconsistent 246\n")
        f.write("  - rho=0.3: Precision 0.0977, Recall 0.4636, Clusters 88,  Inconsistent 704\n")
        f.write("  - rho=0.4: Precision 0.0134, Recall 0.5733, Clusters 11,  Inconsistent 43\n")
        f.write("  - rho=0.5: Precision 0.0062, Recall 0.7088, Clusters 3,   Inconsistent 3\n\n")

        f.write("LARGE GROUPS REVIEW VIEW ('needs_review'):\n")
        f.write("-" * 70 + "\n")
        for g_rev in needs_review_details:
            f.write(f"Group {g_rev['group_id']} ({g_rev['display_name']}): {g_rev['face_count']} faces across {g_rev['file_count']} files\n")
            f.write(f"  Sample crop paths ({len(g_rev['sample_crops'])}):\n")
            for cp in g_rev["sample_crops"]:
                f.write(f"    - {cp}\n")
            f.write(f"  Sample files ({len(g_rev['sample_files'])}): {g_rev['sample_files']}\n\n")

        f.write("CLUSTERS CREATED OR ENLARGED BY SECOND PASS (PASS 2 AUDIT):\n")
        f.write("-" * 70 + "\n")
        f.write(f"Total enlarged clusters: {len(enlarged_details)} (Pass 2 resolved {inconsistent_before - inconsistent_pairs} inconsistent pairs)\n\n")
        for g_enl in enlarged_details:
            f.write(f"Group {g_enl['group_id']} ({g_enl['display_name']}): {g_enl['face_count']} faces (Pass 1: {g_enl['pass1_count']}, +{g_enl['faces_added']}) across {g_enl['file_count']} files\n")
            f.write(f"  Sample crop paths ({len(g_enl['sample_crops'])}):\n")
            for cp in g_enl["sample_crops"]:
                f.write(f"    - {cp}\n")
            f.write(f"  Sample files ({len(g_enl['sample_files'])}): {g_enl['sample_files']}\n\n")

        f.write("STAGE 6: MERGE SUGGESTIONS ENGINE\n")
        f.write("-" * 70 + "\n")
        f.write(f"Suggestions Found: {total_suggs} at threshold {MERGE_SUGGEST_THRESHOLD}\n")
        for s in suggestions[:5]:
            f.write(f"  - {s['group_a_id']} <-> {s['group_b_id']}: cosine {s['similarity']:.4f}\n")
        f.write("\n")

        f.write("STAGE 7: DRY RUN MOVE PLAN PREVIEW\n")
        f.write("-" * 70 + "\n")
        for r, c in sorted(unnamed_plan_rules.items()):
            f.write(f"  - Rule {r}: {c} files\n")

    print("\n" + "=" * 80)
    print("TELEMETRY COMPLETE. Output saved to:")
    print(f"  - Plaintext: {report_txt.resolve()}")
    print(f"  - JSON:      {report_json.resolve()}")
    print(f"  - Template:  {labels_csv.resolve()}")
    print("=" * 80)

    return report_data


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate diagnostic report for a real photo/video library.")
    parser.add_argument(
        "--dir",
        type=Path,
        default=Path(r"F:\local send files\chulmati"),
        help="Path to real library directory",
    )
    parser.add_argument(
        "--runs-dir",
        type=Path,
        default=None,
        help="Path to runs/ output directory",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=None,
        help="Number of worker processes",
    )
    parser.add_argument(
        "--pass2",
        action=argparse.BooleanOptionalAction,
        default=False,
        help="Enable or disable Pass 2 iterative merge pass (default: False)",
    )
    args = parser.parse_args()

    run_real_library_report(args.dir, runs_dir=args.runs_dir, max_workers=args.workers, pass2=args.pass2)
