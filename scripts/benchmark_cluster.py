"""Benchmark clustering time and peak memory on synthetic 128-d face embeddings.

Tests cluster_all_faces with 1k, 5k, and 10k synthetic face embeddings.
Measures execution time and peak memory allocated via tracemalloc.
"""

from __future__ import annotations

import sys
import time
import tracemalloc
from pathlib import Path
import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from nexora.faces.groups import FaceClusterManager


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


if __name__ == "__main__":
    main()
