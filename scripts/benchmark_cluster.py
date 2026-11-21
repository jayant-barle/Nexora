"""Benchmark clustering time, peak memory, and accuracy on synthetic 128-d face embeddings.

Tests cluster_all_faces with:
- 1k, 5k, and 10k synthetic face embeddings for time and peak memory.
- The collapse case (3k faces, 300 people, base + spread 0.5, noise 0.4) for pair precision and recall.
- The well-separated case (10k faces, 1,000 people, noise 0.3) for pair precision, recall, and time.
"""

from __future__ import annotations

import sys
import time
import tracemalloc
from collections import Counter
from pathlib import Path
import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from nexora.faces.groups import FaceClusterManager


def _unit_vec(rng: np.random.Generator, dim: int = 128) -> np.ndarray:
    v = rng.standard_normal(dim).astype(np.float32)
    return v / np.linalg.norm(v)


def generate_synthetic_dataset(n_faces: int, n_identities: int, seed: int = 42) -> dict[str, dict]:
    """Generate n_faces 128-d normalized embeddings clustered around n_identities."""
    rng = np.random.default_rng(seed)
    
    # Generate identity centers on unit sphere
    identity_centers = rng.standard_normal((n_identities, 128), dtype=np.float32)
    norms = np.linalg.norm(identity_centers, axis=1, keepdims=True)
    identity_centers /= norms

    # Distribute faces across identities with noise
    faces_per_id = n_faces // n_identities
    cache: dict[str, dict] = {}

    idx = 0
    for id_idx in range(n_identities):
        count = faces_per_id if id_idx < n_identities - 1 else (n_faces - idx)
        center = identity_centers[id_idx]
        noise = rng.normal(0, 0.15, size=(count, 128)).astype(np.float32)
        embs = center + noise
        embs_norm = embs / np.linalg.norm(embs, axis=1, keepdims=True)

        for j in range(count):
            file_key = f"synthetic_img_{idx:06d}.jpg"
            cache[file_key] = {
                "size": 1024,
                "sha256": f"dummy_sha_{idx}",
                "type": "image",
                "status": "ok",
                "faces": [
                    {
                        "box": [10, 10, 50, 50],
                        "score": 0.95,
                        "embedding": [float(v) for v in embs_norm[j]],
                    }
                ],
            }
            idx += 1

    return cache


def benchmark_size(n_faces: int, n_identities: int, seed: int = 42) -> dict[str, float | int]:
    """Run benchmark for a given number of faces and return metrics."""
    cache = generate_synthetic_dataset(n_faces, n_identities, seed=seed)
    cm = FaceClusterManager(json_path=Path("runs/temp_bench.json"))
    cm.cache = cache

    tracemalloc.start()
    tracemalloc.reset_peak()
    t0 = time.perf_counter()

    cm.cluster_all_faces(threshold=0.363)

    t1 = time.perf_counter()
    _, peak_bytes = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    elapsed = t1 - t0
    peak_mb = peak_bytes / (1024.0 * 1024.0)

    return {
        "n_faces": n_faces,
        "n_clusters": len(cm.groups),
        "time_sec": elapsed,
        "peak_mb": peak_mb,
    }


def compute_pair_metrics(pred_labels: list[str], true_labels: list[int]) -> tuple[float, float]:
    """Compute pairwise precision and recall using a contingency table in O(N)."""
    c_counts = Counter(pred_labels)
    p_counts = Counter(true_labels)
    pair_counts = Counter(zip(pred_labels, true_labels))

    tp = sum(cnt * (cnt - 1) // 2 for cnt in pair_counts.values())
    tp_fp = sum(cnt * (cnt - 1) // 2 for cnt in c_counts.values())
    tp_fn = sum(cnt * (cnt - 1) // 2 for cnt in p_counts.values())

    precision = tp / tp_fp if tp_fp > 0 else 0.0
    recall = tp / tp_fn if tp_fn > 0 else 0.0
    return precision, recall


def benchmark_collapse_case(seed: int = 42) -> dict[str, float | int]:
    """Benchmark the collapse case: 3,000 faces, 300 people, base + spread (spread 0.5, noise 0.4)."""
    rng = np.random.default_rng(seed)
    base = 0.18 * _unit_vec(rng)
    n_people = 300
    faces_per_person = 10

    cache: dict[str, dict] = {}
    true_labels: list[int] = []

    for p in range(n_people):
        spread = 0.5 * _unit_vec(rng)
        cp = base + spread
        cp = cp / np.linalg.norm(cp)
        for i in range(faces_per_person):
            noise = 0.4 * _unit_vec(rng)
            f_emb = cp + noise
            f_emb = f_emb / np.linalg.norm(f_emb)
            fk = f"collapse_img_{p:04d}_{i:02d}.jpg"
            true_labels.append(p)
            cache[fk] = {
                "size": 1024,
                "sha256": f"dummy_sha_{p}_{i}",
                "type": "image",
                "status": "ok",
                "faces": [{"embedding": [float(x) for x in f_emb]}],
            }

    cm = FaceClusterManager(json_path=Path("runs/temp_bench.json"))
    cm.cache = cache

    t0 = time.perf_counter()
    cm.cluster_all_faces(threshold=0.363)
    elapsed = time.perf_counter() - t0

    pred_labels = [
        cm.file_groups[f"collapse_img_{p:04d}_{i:02d}.jpg"][0]
        for p in range(n_people)
        for i in range(faces_per_person)
    ]
    prec, rec = compute_pair_metrics(pred_labels, true_labels)

    return {
        "case": "The collapse case (3k faces, 300 people, base + spread 0.5, noise 0.4)",
        "faces": 3_000,
        "time_sec": elapsed,
        "n_clusters": len(cm.groups),
        "precision": prec,
        "recall": rec,
    }


def benchmark_well_separated_case(seed: int = 42) -> dict[str, float | int]:
    """Benchmark well-separated case: 10,000 faces, 1,000 people, noise 0.3."""
    rng = np.random.default_rng(seed)
    n_people = 1000
    faces_per_person = 10

    cache: dict[str, dict] = {}
    true_labels: list[int] = []

    for p in range(n_people):
        cp = _unit_vec(rng)
        for i in range(faces_per_person):
            noise = 0.3 * _unit_vec(rng)
            f_emb = cp + noise
            f_emb = f_emb / np.linalg.norm(f_emb)
            fk = f"wellsep_img_{p:04d}_{i:02d}.jpg"
            true_labels.append(p)
            cache[fk] = {
                "size": 1024,
                "sha256": f"dummy_sha_{p}_{i}",
                "type": "image",
                "status": "ok",
                "faces": [{"embedding": [float(x) for x in f_emb]}],
            }

    cm = FaceClusterManager(json_path=Path("runs/temp_bench.json"))
    cm.cache = cache

    t0 = time.perf_counter()
    cm.cluster_all_faces(threshold=0.363)
    elapsed = time.perf_counter() - t0

    pred_labels = [
        cm.file_groups[f"wellsep_img_{p:04d}_{i:02d}.jpg"][0]
        for p in range(n_people)
        for i in range(faces_per_person)
    ]
    prec, rec = compute_pair_metrics(pred_labels, true_labels)

    return {
        "case": "Well-separated case (10k faces, 1,000 people, noise 0.3)",
        "faces": 10_000,
        "time_sec": elapsed,
        "n_clusters": len(cm.groups),
        "precision": prec,
        "recall": rec,
    }


def main() -> None:
    print("Running clustering benchmark on synthetic 128-d embeddings...")
    configs = [
        (1_000, 50),
        (5_000, 150),
        (10_000, 300),
    ]

    results = []
    for n_faces, n_ids in configs:
        print(f"Benchmarking {n_faces:,} faces...")
        res = benchmark_size(n_faces, n_ids)
        results.append(res)
        print(f"  -> {res['n_faces']:,} faces: {res['time_sec']:.3f} s, {res['n_clusters']} clusters, peak {res['peak_mb']:.2f} MB")

    print("\n| Faces | Clusters Found | Time (s) | Peak Memory (MB) |")
    print("|---|---|---|---|")
    for r in results:
        print(f"| {r['n_faces']:,} | {r['n_clusters']} | {r['time_sec']:.3f} | {r['peak_mb']:.2f} |")

    print("\n--- Accuracy and Collapse Safeguard Benchmarks ---")
    collapse_res = benchmark_collapse_case()
    print(f"{collapse_res['case']}:")
    print(f"  Time: {collapse_res['time_sec']:.3f} s | Clusters: {collapse_res['n_clusters']} | Pair Precision: {collapse_res['precision']:.4f} | Pair Recall: {collapse_res['recall']:.4f}")

    wellsep_res = benchmark_well_separated_case()
    print(f"{wellsep_res['case']}:")
    print(f"  Time: {wellsep_res['time_sec']:.3f} s | Clusters: {wellsep_res['n_clusters']} | Pair Precision: {wellsep_res['precision']:.4f} | Pair Recall: {wellsep_res['recall']:.4f}")


if __name__ == "__main__":
    main()
