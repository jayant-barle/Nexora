"""Script to measure face recognition and clustering accuracy on a labelled dataset.

Reads tests/faces_labelled/expected_faces.csv (columns: file, person).
Evaluates pairwise precision, pairwise recall, pairwise false-positive rate,
number of clusters, false merges, and false splits.
Writes report to runs/measure_faces_report.json.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path
from typing import Any

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from nexora.faces.detect import detect_faces
from nexora.faces.recognize import embed_face, DEFAULT_THRESHOLD
from nexora.faces.groups import FaceClusterManager, get_runs_dir


def evaluate_dataset(
    csv_path: Path,
    image_dir: Path,
    score_thresholds: list[float] | None = None,
    clustering_threshold: float = DEFAULT_THRESHOLD,
    report_output: Path | None = None,
) -> dict[str, Any]:
    """Run detection, recognition and clustering at multiple score thresholds and compute pairwise metrics."""
    if score_thresholds is None:
        score_thresholds = [0.6, 0.7, 0.85]

    if not csv_path.exists():
        print(f"Dataset not found: {csv_path} does not exist.")
        print("Accuracy not yet measured. Owner review pending.")
        print("To measure accuracy, provide tests/faces_labelled/expected_faces.csv and labelled image files.")
        return {}

    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    if not rows:
        print(f"Dataset {csv_path} is empty.")
        return {}

    if "file" not in rows[0] or "person" not in rows[0]:
        raise ValueError(f"CSV must contain 'file' and 'person' columns, found: {list(rows[0].keys())}")

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

    results_by_threshold: dict[str, Any] = {}
    runs_dir = report_output.parent if report_output else get_runs_dir()
    runs_dir.mkdir(parents=True, exist_ok=True)
    temp_json = runs_dir / "temp_measure_faces.json"

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
                print(f"Warning: Image file not found: {f_name}")
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

        tp = 0  # same person, same cluster
        fp = 0  # diff person, same cluster (False Merge)
        fn = 0  # same person, diff cluster (False Split)
        tn = 0  # diff person, diff cluster

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
            else:
                tn += 1

        precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        fpr = fp / (fp + tn) if (fp + tn) > 0 else 0.0

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
        }

    if temp_json.exists():
        try:
            temp_json.unlink()
        except OSError:
            pass

    out_file = report_output or (runs_dir / "measure_faces_report.json")
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(results_by_threshold, f, indent=2)

    print("\n=== Face Recognition Accuracy Report ===")
    print(f"Dataset: {csv_path} ({len(files_list)} files, {len(set(ground_truth.values()))} people)")
    print(f"{'Score Thresh':<14} | {'Recall':<8} | {'FPR':<8} | {'Precision':<10} | {'Clusters':<9} | {'False Merges':<13} | {'False Splits':<13}")
    print("-" * 88)
    for k, v in results_by_threshold.items():
        print(f"{v['score_threshold']:<14} | {v['pairwise_recall']:<8.4f} | {v['false_positive_rate']:<8.4f} | {v['pairwise_precision']:<10.4f} | {v['num_clusters']:<9} | {v['false_merges_fp']:<13} | {v['false_splits_fn']:<13}")
    print(f"Report written to: {out_file}\n")

    return results_by_threshold


def main() -> None:
    parser = argparse.ArgumentParser(description="Measure face clustering accuracy on labelled dataset.")
    parser.add_argument("--csv", type=Path, default=PROJECT_ROOT / "tests" / "faces_labelled" / "expected_faces.csv", help="Path to expected_faces.csv")
    parser.add_argument("--images", type=Path, default=PROJECT_ROOT / "tests" / "faces_labelled", help="Path to images directory")
    parser.add_argument("--thresholds", nargs="+", type=float, default=[0.6, 0.7, 0.85], help="Detection score thresholds to evaluate")
    parser.add_argument("--clustering-threshold", type=float, default=DEFAULT_THRESHOLD, help="Cosine similarity threshold for clustering")
    parser.add_argument("--output", type=Path, default=PROJECT_ROOT / "runs" / "measure_faces_report.json", help="Path to write report JSON")
    args = parser.parse_args()

    evaluate_dataset(
        csv_path=args.csv,
        image_dir=args.images,
        score_thresholds=args.thresholds,
        clustering_threshold=args.clustering_threshold,
        report_output=args.output,
    )


if __name__ == "__main__":
    main()
