"""Script to measure face recognition and clustering accuracy on a labelled dataset.

Supports both:
- Per-face labelling template (columns: file, face_index, crop_path, box_w, box_h, det_score, person) via --labels.
- Legacy dataset format (columns: file, person) via --csv.

Evaluates:
- Number of labelled faces, unlabelled rows ignored, and distinct people.
- The histogram of same-person and different-person cosine similarities.
- Pairwise precision, recall, and false-positive rate at each detection threshold (0.6, 0.7, 0.85).
- The number of clusters found.
- The list of specific file names and faces involved in false merges.
- When --labels is used: a breakdown table of wrong merges and wrong splits by face size bucket
  (under 60px, 60–100px, over 100px) and by detection score bucket (<0.70, 0.70–0.85, 0.85–0.95, >0.95).

Writes formatted report to runs/measure_report.txt and runs/measure_faces_report.json.
If no labelled data is found or the specified file is missing, prints a clear message and exits cleanly.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from collections import Counter
from pathlib import Path
from typing import Any
import numpy as np

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from nexora.faces.detect import detect_faces, read_image_bgr, get_face_box_and_score
from nexora.faces.recognize import embed_face, cosine_similarity, DEFAULT_THRESHOLD
from nexora.faces.groups import FaceClusterManager, get_runs_dir


HISTOGRAM_BINS = [
    (-1.0, 0.0),
    (0.0, 0.1),
    (0.1, 0.2),
    (0.2, 0.3),
    (0.3, 0.363),
    (0.363, 0.4),
    (0.4, 0.5),
    (0.5, 0.6),
    (0.6, 0.7),
    (0.7, 0.8),
    (0.8, 0.9),
    (0.9, 1.0001),
]

SIZE_BUCKET_KEYS = ["<60px", "60–100px", ">100px"]
SCORE_BUCKET_KEYS = ["<0.70", "0.70–0.85", "0.85–0.95", ">0.95"]


def classify_face_size(w: float, h: float) -> str:
    """Classify face size into under 60px, 60–100px, or over 100px."""
    size = min(w, h) if (w > 0 and h > 0) else max(w, h)
    if size < 60:
        return "<60px"
    elif size <= 100:
        return "60–100px"
    else:
        return ">100px"


def classify_detection_score(score: float) -> str:
    """Classify detection score into standard confidence buckets."""
    if score < 0.70:
        return "<0.70"
    elif score < 0.85:
        return "0.70–0.85"
    elif score < 0.95:
        return "0.85–0.95"
    else:
        return ">0.95"


def compute_similarity_histogram(
    similarities: list[float],
    bins: list[tuple[float, float]] = HISTOGRAM_BINS,
) -> list[int]:
    """Bin a list of cosine similarities."""
    counts = [0] * len(bins)
    for s in similarities:
        for idx, (low, high) in enumerate(bins):
            if low <= s < high:
                counts[idx] += 1
                break
    return counts


def format_histogram_table(
    same_sims: list[float],
    diff_sims: list[float],
    bins: list[tuple[float, float]] = HISTOGRAM_BINS,
) -> str:
    """Format an ASCII histogram table comparing same-person and different-person similarities."""
    same_counts = compute_similarity_histogram(same_sims, bins)
    diff_counts = compute_similarity_histogram(diff_sims, bins)

    lines = []
    lines.append(f"{'Cosine Sim Bin':<18} | {'Same-Person Pairs':<18} | {'Diff-Person Pairs':<18}")
    lines.append("-" * 60)
    for (low, high), s_cnt, d_cnt in zip(bins, same_counts, diff_counts):
        bin_label = f"[{low:.3f}, {high:.3f})" if high <= 1.0 else f"[{low:.3f}, 1.000]"
        lines.append(f"{bin_label:<18} | {s_cnt:<18} | {d_cnt:<18}")

    lines.append("-" * 60)
    if same_sims:
        s_min, s_mean, s_max = min(same_sims), float(np.mean(same_sims)), max(same_sims)
        lines.append(f"Same-person stats: count={len(same_sims)}, min={s_min:.4f}, mean={s_mean:.4f}, max={s_max:.4f}")
    else:
        lines.append("Same-person stats: count=0")

    if diff_sims:
        d_min, d_mean, d_max = min(diff_sims), float(np.mean(diff_sims)), max(diff_sims)
        lines.append(f"Diff-person stats: count={len(diff_sims)}, min={d_min:.4f}, mean={d_mean:.4f}, max={d_max:.4f}")
    else:
        lines.append("Diff-person stats: count=0")

    return "\n".join(lines)


def evaluate_dataset(
    csv_path: Path,
    image_dir: Path | None = None,
    score_thresholds: list[float] | None = None,
    clustering_threshold: float = DEFAULT_THRESHOLD,
    txt_report_output: Path | None = None,
    json_report_output: Path | None = None,
    is_labels: bool = False,
) -> dict[str, Any]:
    """Run detection, recognition, histogram calculation, and clustering on a labelled dataset."""
    runs_dir = txt_report_output.parent if txt_report_output else get_runs_dir()
    runs_dir.mkdir(parents=True, exist_ok=True)
    report_txt_file = txt_report_output or (runs_dir / "measure_report.txt")

    # If dataset is missing, report clean message and exit cleanly
    if not csv_path.exists():
        msg = (
            f"No labelled dataset found at {csv_path}.\n"
            "Accuracy not yet measured. Owner review pending.\n"
            "To measure accuracy, provide a labelled CSV and image files.\n"
        )
        print(msg)
        with open(report_txt_file, "w", encoding="utf-8") as f:
            f.write(msg)
        return {}

    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    if not rows:
        msg = f"Dataset {csv_path} is empty.\nAccuracy not yet measured. Owner review pending.\n"
        print(msg)
        with open(report_txt_file, "w", encoding="utf-8") as f:
            f.write(msg)
        return {}

    if "file" not in rows[0] or "person" not in rows[0]:
        raise ValueError(f"CSV must contain 'file' and 'person' columns, found: {list(rows[0].keys())}")

    is_per_face_template = is_labels or ("face_index" in rows[0])

    labelled_faces: list[dict[str, Any]] = []
    unlabelled_rows_count = 0

    for r in rows:
        f_name = r["file"].strip()
        person = r["person"].strip() if r.get("person") else ""
        if not person:
            unlabelled_rows_count += 1
            continue
        try:
            f_idx = int(r["face_index"].strip()) if (is_per_face_template and r.get("face_index") is not None) else 0
        except (ValueError, TypeError):
            f_idx = 0
        crop_path = r.get("crop_path", "").strip()

        try:
            box_w = float(r.get("box_w", 0))
        except (ValueError, TypeError):
            box_w = 0.0
        try:
            box_h = float(r.get("box_h", 0))
        except (ValueError, TypeError):
            box_h = 0.0
        try:
            det_score = float(r.get("det_score", 0.0))
        except (ValueError, TypeError):
            det_score = 0.0

        face_id = f"{f_name}:{f_idx}"
        labelled_faces.append({
            "face_id": face_id,
            "file": f_name,
            "face_index": f_idx,
            "crop_path": crop_path,
            "box_w": box_w,
            "box_h": box_h,
            "det_score": det_score,
            "person": person,
        })

    if not labelled_faces:
        msg = (
            f"Dataset {csv_path} contains {unlabelled_rows_count} unlabelled rows and 0 labelled faces.\n"
            "Accuracy not yet measured. Owner review pending.\n"
        )
        print(msg)
        with open(report_txt_file, "w", encoding="utf-8") as f:
            f.write(msg)
        return {
            "summary": {
                "csv_path": str(csv_path),
                "labelled_faces": 0,
                "unlabelled_rows_ignored": unlabelled_rows_count,
                "distinct_people": 0,
                "people": [],
                "total_files": 0,
            }
        }

    if score_thresholds is None:
        score_thresholds = [0.6, 0.7, 0.85]

    num_labelled_faces = len(labelled_faces)
    num_unlabelled_ignored = unlabelled_rows_count
    distinct_people = sorted(list(set(f["person"] for f in labelled_faces)))
    num_distinct_people = len(distinct_people)
    unique_files = sorted(list(set(f["file"] for f in labelled_faces)))

    gt_same_pairs: list[tuple[dict[str, Any], dict[str, Any]]] = []
    gt_diff_pairs: list[tuple[dict[str, Any], dict[str, Any]]] = []

    for i in range(num_labelled_faces):
        for j in range(i + 1, num_labelled_faces):
            face_i, face_j = labelled_faces[i], labelled_faces[j]
            if face_i["person"] == face_j["person"]:
                gt_same_pairs.append((face_i, face_j))
            else:
                gt_diff_pairs.append((face_i, face_j))

    def resolve_file(f_name: str) -> Path:
        p = Path(f_name)
        if p.is_absolute() and p.exists():
            return p
        if image_dir and (image_dir / f_name).exists():
            return image_dir / f_name
        if (csv_path.parent / f_name).exists():
            return csv_path.parent / f_name
        if image_dir:
            return image_dir / f_name
        return csv_path.parent / f_name

    temp_json = runs_dir / "temp_measure_faces.json"
    results_by_threshold: dict[str, Any] = {}
    report_lines: list[str] = []

    report_lines.append("================================================================================")
    report_lines.append("FACE RECOGNITION AND CLUSTERING ACCURACY REPORT (LABELLED DATASET)")
    report_lines.append("================================================================================")
    report_lines.append(f"CSV Path:                {csv_path}")
    report_lines.append(f"Images Dir:              {image_dir if image_dir else 'auto'}")
    report_lines.append(f"Labelled faces:          {num_labelled_faces}")
    report_lines.append(f"Unlabelled rows ignored: {num_unlabelled_ignored}")
    report_lines.append(f"Distinct people:         {num_distinct_people} ({', '.join(distinct_people)})")
    report_lines.append(f"Files:                   {len(unique_files)}")
    report_lines.append(f"Same-person pairs:       {len(gt_same_pairs)}, Diff-person pairs: {len(gt_diff_pairs)}")
    report_lines.append("")

    # Extract embeddings for default detection threshold (0.85) to compute similarity histograms
    embeddings_by_face: dict[tuple[str, int], np.ndarray | None] = {}
    for f_name in unique_files:
        f_path = resolve_file(f_name)
        if not f_path.exists():
            continue

        faces = detect_faces(f_path, score_threshold=0.85)
        for f_idx, face in enumerate(faces):
            emb = embed_face(f_path, face)
            if emb is not None:
                norm_v = float(np.linalg.norm(emb))
                embeddings_by_face[(f_name, f_idx)] = (emb / norm_v) if norm_v > 0 else emb

            # Fallback quality metadata if not provided in CSV
            for lf in labelled_faces:
                if lf["file"] == f_name and lf["face_index"] == f_idx:
                    if lf["box_w"] == 0 or lf["box_h"] == 0:
                        lf["box_w"] = int(round(float(face[2]))) if len(face) > 2 else 0
                        lf["box_h"] = int(round(float(face[3]))) if len(face) > 3 else 0
                    if lf["det_score"] == 0.0:
                        lf["det_score"] = float(face[14]) if len(face) > 14 else 1.0

    same_sims: list[float] = []
    diff_sims: list[float] = []
    for f_i, f_j in gt_same_pairs:
        e_i = embeddings_by_face.get((f_i["file"], f_i["face_index"]))
        e_j = embeddings_by_face.get((f_j["file"], f_j["face_index"]))
        if e_i is not None and e_j is not None:
            same_sims.append(float(e_i @ e_j))

    for f_i, f_j in gt_diff_pairs:
        e_i = embeddings_by_face.get((f_i["file"], f_i["face_index"]))
        e_j = embeddings_by_face.get((f_j["file"], f_j["face_index"]))
        if e_i is not None and e_j is not None:
            diff_sims.append(float(e_i @ e_j))

    report_lines.append("--- 1. COSINE SIMILARITY HISTOGRAM (SAME-PERSON vs DIFFERENT-PERSON) ---")
    report_lines.append(format_histogram_table(same_sims, diff_sims))
    report_lines.append("")

    report_lines.append("--- 2. ACCURACY & CLUSTERING ACROSS THRESHOLDS ---")
    report_lines.append(f"{'Score Thresh':<14} | {'Recall':<8} | {'Precision':<10} | {'FPR':<8} | {'Clusters':<9} | {'False Merges':<13} | {'False Splits':<13}")
    report_lines.append("-" * 92)

    all_false_merges_by_threshold: dict[float, list[dict[str, Any]]] = {}
    quality_breakdown_by_threshold: dict[float, dict[str, Any]] = {}

    # Pre-calculate counts of labelled faces in each size and score bucket
    faces_by_size: dict[str, int] = {k: 0 for k in SIZE_BUCKET_KEYS}
    faces_by_score: dict[str, int] = {k: 0 for k in SCORE_BUCKET_KEYS}
    for lf in labelled_faces:
        sb = classify_face_size(lf["box_w"], lf["box_h"])
        scb = classify_detection_score(lf["det_score"])
        faces_by_size[sb] = faces_by_size.get(sb, 0) + 1
        faces_by_score[scb] = faces_by_score.get(scb, 0) + 1

    for score_thresh in score_thresholds:
        cm = FaceClusterManager(json_path=temp_json)
        cm.cache = {}
        cm.groups = []
        cm.file_groups = {}
        cm.face_names = {}

        file_path_map: dict[str, Path] = {}

        for f_name in unique_files:
            f_path = resolve_file(f_name)
            file_path_map[f_name] = f_path
            if not f_path.exists():
                continue

            faces = detect_faces(f_path, score_threshold=score_thresh)
            face_records = []
            for face in faces:
                emb = embed_face(f_path, face)
                if emb is not None:
                    box = [int(v) for v in face[0:4]]
                    score = float(face[14]) if len(face) > 14 else 1.0
                    box_w = int(round(float(face[2]))) if len(face) > 2 else (box[2] if len(box) > 2 else 0)
                    box_h = int(round(float(face[3]))) if len(face) > 3 else (box[3] if len(box) > 3 else 0)
                    face_records.append({
                        "box": box,
                        "box_w": box_w,
                        "box_h": box_h,
                        "score": score,
                        "det_score": score,
                        "embedding": [float(x) for x in emb],
                    })

            cm.cache[str(f_path.resolve())] = {
                "size": f_path.stat().st_size if f_path.exists() else 0,
                "sha256": "dummy",
                "type": "image",
                "status": "ok",
                "faces": face_records,
            }

        cm.cluster_all_faces(threshold=clustering_threshold)

        face_predicted_cluster: dict[tuple[str, int], str | None] = {}
        for f in labelled_faces:
            f_name = f["file"]
            f_idx = f["face_index"]
            f_path = file_path_map.get(f_name)
            if f_path is None or not f_path.exists():
                face_predicted_cluster[(f_name, f_idx)] = None
                continue
            res_key = str(f_path.resolve())
            gids = cm.file_groups.get(res_key, [])
            if f_idx < len(gids):
                face_predicted_cluster[(f_name, f_idx)] = gids[f_idx]
            else:
                face_predicted_cluster[(f_name, f_idx)] = None

        tp = 0
        fp = 0
        fn = 0
        tn = 0
        false_merge_details: list[dict[str, Any]] = []

        # Quality bucket counters for wrong merges (FP) and wrong splits (FN)
        wm_by_size = {k: 0 for k in SIZE_BUCKET_KEYS}
        ws_by_size = {k: 0 for k in SIZE_BUCKET_KEYS}
        wm_by_score = {k: 0 for k in SCORE_BUCKET_KEYS}
        ws_by_score = {k: 0 for k in SCORE_BUCKET_KEYS}

        for f_i, f_j in gt_same_pairs:
            c_i = face_predicted_cluster.get((f_i["file"], f_i["face_index"]))
            c_j = face_predicted_cluster.get((f_j["file"], f_j["face_index"]))

            # Pair limiting quality metrics (lowest quality in pair)
            s_i = min(f_i["box_w"], f_i["box_h"]) if (f_i["box_w"] > 0 and f_i["box_h"] > 0) else max(f_i["box_w"], f_i["box_h"])
            s_j = min(f_j["box_w"], f_j["box_h"]) if (f_j["box_w"] > 0 and f_j["box_h"] > 0) else max(f_j["box_w"], f_j["box_h"])
            pair_size = min(s_i, s_j)
            pair_size_bucket = classify_face_size(pair_size, pair_size)

            pair_score = min(f_i["det_score"], f_j["det_score"])
            pair_score_bucket = classify_detection_score(pair_score)

            if c_i is not None and c_j is not None and c_i == c_j:
                tp += 1
            else:
                fn += 1
                ws_by_size[pair_size_bucket] = ws_by_size.get(pair_size_bucket, 0) + 1
                ws_by_score[pair_score_bucket] = ws_by_score.get(pair_score_bucket, 0) + 1

        for f_i, f_j in gt_diff_pairs:
            c_i = face_predicted_cluster.get((f_i["file"], f_i["face_index"]))
            c_j = face_predicted_cluster.get((f_j["file"], f_j["face_index"]))

            # Pair limiting quality metrics (lowest quality in pair)
            s_i = min(f_i["box_w"], f_i["box_h"]) if (f_i["box_w"] > 0 and f_i["box_h"] > 0) else max(f_i["box_w"], f_i["box_h"])
            s_j = min(f_j["box_w"], f_j["box_h"]) if (f_j["box_w"] > 0 and f_j["box_h"] > 0) else max(f_j["box_w"], f_j["box_h"])
            pair_size = min(s_i, s_j)
            pair_size_bucket = classify_face_size(pair_size, pair_size)

            pair_score = min(f_i["det_score"], f_j["det_score"])
            pair_score_bucket = classify_detection_score(pair_score)

            if c_i is not None and c_j is not None and c_i == c_j:
                fp += 1
                wm_by_size[pair_size_bucket] = wm_by_size.get(pair_size_bucket, 0) + 1
                wm_by_score[pair_score_bucket] = wm_by_score.get(pair_score_bucket, 0) + 1
                false_merge_details.append({
                    "file_a": f_i["file"],
                    "face_index_a": f_i["face_index"],
                    "person_a": f_i["person"],
                    "box_w_a": f_i["box_w"],
                    "box_h_a": f_i["box_h"],
                    "det_score_a": f_i["det_score"],
                    "file_b": f_j["file"],
                    "face_index_b": f_j["face_index"],
                    "person_b": f_j["person"],
                    "box_w_b": f_j["box_w"],
                    "box_h_b": f_j["box_h"],
                    "det_score_b": f_j["det_score"],
                    "cluster_id": c_i,
                    "limiting_size": pair_size,
                    "size_bucket": pair_size_bucket,
                    "limiting_score": pair_score,
                    "score_bucket": pair_score_bucket,
                })
            else:
                tn += 1

        precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        fpr = fp / (fp + tn) if (fp + tn) > 0 else 0.0

        all_false_merges_by_threshold[score_thresh] = false_merge_details

        line = f"{score_thresh:<14} | {recall:<8.4f} | {precision:<10.4f} | {fpr:<8.4f} | {len(cm.groups):<9} | {fp:<13} | {fn:<13}"
        report_lines.append(line)

        # Build quality summary structures
        size_quality_dict = {}
        for sb in SIZE_BUCKET_KEYS:
            entry = {
                "labelled_faces": faces_by_size.get(sb, 0),
                "wrong_merges": wm_by_size.get(sb, 0),
                "wrong_merges_fp": wm_by_size.get(sb, 0),
                "wrong_splits": ws_by_size.get(sb, 0),
                "wrong_splits_fn": ws_by_size.get(sb, 0),
            }
            size_quality_dict[sb] = entry
            # Convenient aliases
            if sb == "60–100px":
                size_quality_dict["60-100px"] = entry
            elif sb == "<60px":
                size_quality_dict["under 60px"] = entry
            elif sb == ">100px":
                size_quality_dict["over 100px"] = entry

        score_quality_dict = {}
        for scb in SCORE_BUCKET_KEYS:
            entry = {
                "labelled_faces": faces_by_score.get(scb, 0),
                "wrong_merges": wm_by_score.get(scb, 0),
                "wrong_merges_fp": wm_by_score.get(scb, 0),
                "wrong_splits": ws_by_score.get(scb, 0),
                "wrong_splits_fn": ws_by_score.get(scb, 0),
            }
            score_quality_dict[scb] = entry
            if "–" in scb:
                score_quality_dict[scb.replace("–", "-")] = entry

        quality_breakdown_by_threshold[score_thresh] = {
            "by_size_bucket": size_quality_dict,
            "by_score_bucket": score_quality_dict,
        }

        results_by_threshold[f"score_{score_thresh}"] = {
            "score_threshold": score_thresh,
            "clustering_threshold": clustering_threshold,
            "num_clusters": len(cm.groups),
            "pairwise_precision": round(precision, 4),
            "pairwise_recall": round(recall, 4),
            "false_positive_rate": round(fpr, 4),
            "false_merges_fp": fp,
            "false_splits_fn": fn,
            "true_positives_tp": tp,
            "true_negatives_tn": tn,
            "false_merges": false_merge_details,
            "quality_by_size": size_quality_dict,
            "quality_by_score": score_quality_dict,
        }

    report_lines.append("")
    report_lines.append("--- 3. FALSE MERGES DETAILED FILE LIST ---")
    for st, f_merges in all_false_merges_by_threshold.items():
        report_lines.append(f"Detection score threshold {st}: ({len(f_merges)} false merges)")
        if not f_merges:
            report_lines.append("  None (0 false merges)")
        else:
            for fm in f_merges:
                report_lines.append(
                    f"  - '{fm['file_a']}' (face {fm['face_index_a']}, Person: {fm['person_a']}) "
                    f"MERGED WITH '{fm['file_b']}' (face {fm['face_index_b']}, Person: {fm['person_b']}) "
                    f"in cluster '{fm['cluster_id']}'"
                )
    report_lines.append("")

    # Add Quality Metrics Table when --labels is used
    primary_quality = quality_breakdown_by_threshold.get(0.85, quality_breakdown_by_threshold.get(score_thresholds[-1]))
    if is_per_face_template and primary_quality:
        report_lines.append("--- 4. WRONG MERGES AND WRONG SPLITS BY FACE QUALITY ---")
        report_lines.append("[By Face Size Bucket (default threshold 0.85)]")
        report_lines.append(f"{'Size Bucket':<18} | {'Labelled Faces':<15} | {'Wrong Merges (FP)':<18} | {'Wrong Splits (FN)':<18}")
        report_lines.append("-" * 76)
        for sb in SIZE_BUCKET_KEYS:
            l_cnt = faces_by_size.get(sb, 0)
            wm = primary_quality["by_size_bucket"][sb]["wrong_merges"]
            ws = primary_quality["by_size_bucket"][sb]["wrong_splits"]
            report_lines.append(f"{sb:<18} | {l_cnt:<15} | {wm:<18} | {ws:<18}")
        report_lines.append("-" * 76)
        report_lines.append("")

        report_lines.append("[By Detection Score Bucket (default threshold 0.85)]")
        report_lines.append(f"{'Score Bucket':<18} | {'Labelled Faces':<15} | {'Wrong Merges (FP)':<18} | {'Wrong Splits (FN)':<18}")
        report_lines.append("-" * 76)
        for scb in SCORE_BUCKET_KEYS:
            l_cnt = faces_by_score.get(scb, 0)
            wm = primary_quality["by_score_bucket"][scb]["wrong_merges"]
            ws = primary_quality["by_score_bucket"][scb]["wrong_splits"]
            report_lines.append(f"{scb:<18} | {l_cnt:<15} | {wm:<18} | {ws:<18}")
        report_lines.append("-" * 76)
        report_lines.append("")

    if temp_json.exists():
        try:
            temp_json.unlink()
        except OSError:
            pass

    # Write report text
    final_text = "\n".join(report_lines)
    with open(report_txt_file, "w", encoding="utf-8") as f:
        f.write(final_text)

    # Write report json
    out_json_file = json_report_output or (runs_dir / "measure_faces_report.json")
    complete_report_dict = {
        "summary": {
            "csv_path": str(csv_path),
            "labelled_faces": num_labelled_faces,
            "unlabelled_rows_ignored": num_unlabelled_ignored,
            "distinct_people": num_distinct_people,
            "people": distinct_people,
            "total_files": len(unique_files),
            "same_person_pairs": len(gt_same_pairs),
            "diff_person_pairs": len(gt_diff_pairs),
            "quality_by_size": primary_quality["by_size_bucket"] if primary_quality else {},
            "quality_by_score": primary_quality["by_score_bucket"] if primary_quality else {},
        },
        "quality_metrics": primary_quality if primary_quality else {},
        **results_by_threshold,
    }

    with open(out_json_file, "w", encoding="utf-8") as f:
        json.dump(complete_report_dict, f, indent=2)

    print(final_text)
    print(f"\nText report written to: {report_txt_file}")
    print(f"JSON report written to: {out_json_file}\n")

    return complete_report_dict


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Measure face clustering accuracy on labelled dataset.")
    parser.add_argument("--labels", type=Path, default=None, help="Path to per-face labelling template CSV (file, face_index, crop_path, person)")
    parser.add_argument("--csv", type=Path, default=None, help="Path to expected_faces.csv (legacy format: file, person)")
    parser.add_argument("--images", type=Path, default=None, help="Path to images directory")
    parser.add_argument("--thresholds", nargs="+", type=float, default=[0.6, 0.7, 0.85], help="Detection score thresholds to evaluate")
    parser.add_argument("--clustering-threshold", type=float, default=DEFAULT_THRESHOLD, help="Cosine similarity threshold for clustering")
    parser.add_argument("--output-txt", type=Path, default=PROJECT_ROOT / "runs" / "measure_report.txt", help="Path to write report TXT")
    parser.add_argument("--output-json", type=Path, default=PROJECT_ROOT / "runs" / "measure_faces_report.json", help="Path to write report JSON")
    args = parser.parse_args(argv)

    is_labels = False
    if args.labels is not None:
        target_csv = args.labels
        is_labels = True
    elif args.csv is not None:
        target_csv = args.csv
    else:
        target_csv = PROJECT_ROOT / "tests" / "faces_labelled" / "expected_faces.csv"

    if args.images is not None:
        target_images = args.images
    else:
        if args.labels is not None:
            target_images = target_csv.parent
        else:
            target_images = PROJECT_ROOT / "tests" / "faces_labelled"

    evaluate_dataset(
        csv_path=target_csv,
        image_dir=target_images,
        score_thresholds=args.thresholds,
        clustering_threshold=args.clustering_threshold,
        txt_report_output=args.output_txt,
        json_report_output=args.output_json,
        is_labels=is_labels,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
