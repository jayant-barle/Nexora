"""Script to measure face recognition and clustering accuracy on a labelled dataset.

Reads tests/faces_labelled/expected_faces.csv (columns: file, person).
Evaluates:
- The histogram of same-person and different-person cosine similarities.
- Pairwise precision, recall, and false-positive rate at each threshold.
- The number of clusters found.
- The list of specific file names involved in false merges.
Writes formatted report to runs/measure_report.txt and runs/measure_faces_report.json.
If no labelled data is found, prints a clear message and exits cleanly (no crash, no fake numbers).
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

from nexora.faces.detect import detect_faces
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
    image_dir: Path,
    score_thresholds: list[float] | None = None,
    clustering_threshold: float = DEFAULT_THRESHOLD,
    txt_report_output: Path | None = None,
    json_report_output: Path | None = None,
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
            "To measure accuracy, provide tests/faces_labelled/expected_faces.csv and labelled image files.\n"
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

    if score_thresholds is None:
        score_thresholds = [0.6, 0.7, 0.85]

    ground_truth: dict[str, str] = {}
    for r in rows:
        f_name = r["file"].strip()
        person = r["person"].strip()
        ground_truth[f_name] = person

    files_list = sorted(ground_truth.keys())
    n = len(files_list)

    gt_same_pairs: set[tuple[str, str]] = set()
    gt_diff_pairs: set[tuple[str, str]] = set()
    for i in range(n):
        for j in range(i + 1, n):
            f_i, f_j = files_list[i], files_list[j]
            if ground_truth[f_i] == ground_truth[f_j]:
                gt_same_pairs.add((f_i, f_j))
            else:
                gt_diff_pairs.add((f_i, f_j))

    temp_json = runs_dir / "temp_measure_faces.json"
    results_by_threshold: dict[str, Any] = {}
    report_lines: list[str] = []

    report_lines.append("================================================================================")
    report_lines.append("FACE RECOGNITION AND CLUSTERING ACCURACY REPORT (LABELLED DATASET)")
    report_lines.append("================================================================================")
    report_lines.append(f"CSV Path:   {csv_path}")
    report_lines.append(f"Images Dir: {image_dir}")
    report_lines.append(f"Files:      {len(files_list)}")
    report_lines.append(f"Identities: {len(set(ground_truth.values()))}")
    report_lines.append(f"Same-person pairs: {len(gt_same_pairs)}, Diff-person pairs: {len(gt_diff_pairs)}")
    report_lines.append("")

    # Extract embeddings for default detection threshold (0.85) to compute similarity histograms
    embeddings_by_file: dict[str, np.ndarray | None] = {}
    for f_name in files_list:
        f_path = image_dir / f_name
        if not f_path.exists():
            f_path = csv_path.parent / f_name
        if not f_path.exists():
            embeddings_by_file[f_name] = None
            continue

        faces = detect_faces(f_path, score_threshold=0.85)
        if faces:
            emb = embed_face(f_path, faces[0])
            if emb is not None:
                norm_v = float(np.linalg.norm(emb))
                embeddings_by_file[f_name] = (emb / norm_v) if norm_v > 0 else emb
            else:
                embeddings_by_file[f_name] = None
        else:
            embeddings_by_file[f_name] = None

    same_sims: list[float] = []
    diff_sims: list[float] = []
    for f_i, f_j in gt_same_pairs:
        e_i, e_j = embeddings_by_file.get(f_i), embeddings_by_file.get(f_j)
        if e_i is not None and e_j is not None:
            same_sims.append(float(e_i @ e_j))

    for f_i, f_j in gt_diff_pairs:
        e_i, e_j = embeddings_by_file.get(f_i), embeddings_by_file.get(f_j)
        if e_i is not None and e_j is not None:
            diff_sims.append(float(e_i @ e_j))

    report_lines.append("--- 1. COSINE SIMILARITY HISTOGRAM (SAME-PERSON vs DIFFERENT-PERSON) ---")
    report_lines.append(format_histogram_table(same_sims, diff_sims))
    report_lines.append("")

    report_lines.append("--- 2. ACCURACY & CLUSTERING ACROSS THRESHOLDS ---")
    report_lines.append(f"{'Score Thresh':<14} | {'Recall':<8} | {'Precision':<10} | {'FPR':<8} | {'Clusters':<9} | {'False Merges':<13} | {'False Splits':<13}")
    report_lines.append("-" * 92)

    all_false_merges_by_threshold: dict[float, list[dict[str, str]]] = {}

    for score_thresh in score_thresholds:
        cm = FaceClusterManager(json_path=temp_json)
        cm.cache = {}
        cm.groups = []
        cm.file_groups = {}
        cm.face_names = {}

        file_predicted_cluster: dict[str, str | None] = {}

        for f_name in files_list:
            f_path = image_dir / f_name
            if not f_path.exists():
                f_path = csv_path.parent / f_name
            if not f_path.exists():
                file_predicted_cluster[f_name] = None
                continue

            faces = detect_faces(f_path, score_threshold=score_thresh)
            face_records = []
            for face in faces:
                emb = embed_face(f_path, face)
                if emb is not None:
                    box = [int(v) for v in face[0:4]]
                    score = float(face[14]) if len(face) > 14 else 1.0
                    face_records.append({
                        "box": box,
                        "score": score,
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

        for f_name in files_list:
            f_path = image_dir / f_name
            if not f_path.exists():
                f_path = csv_path.parent / f_name
            res_key = str(f_path.resolve())
            gids = cm.file_groups.get(res_key, [])
            file_predicted_cluster[f_name] = gids[0] if gids else None

        tp = 0
        fp = 0
        fn = 0
        tn = 0
        false_merge_details: list[dict[str, str]] = []

        for f_i, f_j in gt_same_pairs:
            c_i = file_predicted_cluster.get(f_i)
            c_j = file_predicted_cluster.get(f_j)
            if c_i is not None and c_j is not None and c_i == c_j:
                tp += 1
            else:
                fn += 1

        for f_i, f_j in gt_diff_pairs:
            c_i = file_predicted_cluster.get(f_i)
            c_j = file_predicted_cluster.get(f_j)
            if c_i is not None and c_j is not None and c_i == c_j:
                fp += 1
                false_merge_details.append({
                    "file_a": f_i,
                    "person_a": ground_truth[f_i],
                    "file_b": f_j,
                    "person_b": ground_truth[f_j],
                    "cluster_id": c_i,
                })
            else:
                tn += 1

        precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        fpr = fp / (fp + tn) if (fp + tn) > 0 else 0.0

        all_false_merges_by_threshold[score_thresh] = false_merge_details

        line = f"{score_thresh:<14} | {recall:<8.4f} | {precision:<10.4f} | {fpr:<8.4f} | {len(cm.groups):<9} | {fp:<13} | {fn:<13}"
        report_lines.append(line)

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
                    f"  - '{fm['file_a']}' (Person: {fm['person_a']}) MERGED WITH '{fm['file_b']}' (Person: {fm['person_b']}) in cluster '{fm['cluster_id']}'"
                )
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
    with open(out_json_file, "w", encoding="utf-8") as f:
        json.dump(results_by_threshold, f, indent=2)

    print(final_text)
    print(f"\nText report written to: {report_txt_file}")
    print(f"JSON report written to: {out_json_file}\n")

    return results_by_threshold


def main() -> None:
    parser = argparse.ArgumentParser(description="Measure face clustering accuracy on labelled dataset.")
    parser.add_argument("--csv", type=Path, default=PROJECT_ROOT / "tests" / "faces_labelled" / "expected_faces.csv", help="Path to expected_faces.csv")
    parser.add_argument("--images", type=Path, default=PROJECT_ROOT / "tests" / "faces_labelled", help="Path to images directory")
    parser.add_argument("--thresholds", nargs="+", type=float, default=[0.6, 0.7, 0.85], help="Detection score thresholds to evaluate")
    parser.add_argument("--clustering-threshold", type=float, default=DEFAULT_THRESHOLD, help="Cosine similarity threshold for clustering")
    parser.add_argument("--output-txt", type=Path, default=PROJECT_ROOT / "runs" / "measure_report.txt", help="Path to write report TXT")
    parser.add_argument("--output-json", type=Path, default=PROJECT_ROOT / "runs" / "measure_faces_report.json", help="Path to write report JSON")
    args = parser.parse_args()

    evaluate_dataset(
        csv_path=args.csv,
        image_dir=args.images,
        score_thresholds=args.thresholds,
        clustering_threshold=args.clustering_threshold,
        txt_report_output=args.output_txt,
        json_report_output=args.output_json,
    )
    sys.exit(0)


if __name__ == "__main__":
    main()
