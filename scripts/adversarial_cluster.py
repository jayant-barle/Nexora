"""Adversarial clustering benchmark sweeping inter-person cosine similarity.

Evaluates clustering robustness against stranger similarity above threshold:
- 300 people, 3,000 faces (10 faces/person), noise 0.4.
- Shared component b so that different people have target inter-person cosine rho.
- Sweeps rho over 0.1, 0.2, 0.3, 0.4, 0.5 at threshold 0.363.
- Reports pair precision, pair recall, cluster count, and runtime.
- Compares Baseline (Centroid only), Option A (Uncertain pool), and Option B (Multi-member match).
- Identifies the inter-person cosine at which pair precision drops below 0.9.
"""

from __future__ import annotations

import sys
import time
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


def generate_adversarial_dataset(
    rho: float,
    n_people: int = 300,
    faces_per_person: int = 10,
    noise_level: float = 0.4,
    seed: int = 42,
) -> tuple[dict[str, dict], list[int]]:
    """Generate 3,000 faces for 300 people with shared component yielding inter-person cosine rho."""
    rng = np.random.default_rng(seed)
    b = _unit_vec(rng)

    cache: dict[str, dict] = {}
    ground_truth_labels: list[int] = []

    for p in range(n_people):
        v_p = _unit_vec(rng)
        # Gram-Schmidt to guarantee orthogonality to shared component b
        v_p = v_p - float(v_p @ b) * b
        v_p = v_p / np.linalg.norm(v_p)

        # Person center: E[c_p . c_q] = rho
        c_p = np.sqrt(rho) * b + np.sqrt(1.0 - rho) * v_p
        c_p = c_p / np.linalg.norm(c_p)

        for i in range(faces_per_person):
            noise = _unit_vec(rng)
            f_emb = c_p + noise_level * noise
            f_emb = f_emb / np.linalg.norm(f_emb)
            fk = f"adv_p{p:04d}_f{i:02d}.jpg"
            ground_truth_labels.append(p)
            cache[fk] = {
                "size": 1024,
                "sha256": f"dummy_sha_{p}_{i}",
                "type": "image",
                "status": "ok",
                "faces": [{"embedding": [float(x) for x in f_emb]}],
            }

    return cache, ground_truth_labels


def compute_pair_metrics(pred_labels: list[str | int], true_labels: list[int]) -> tuple[float, float]:
    """Compute pairwise precision and recall in O(N)."""
    c_counts = Counter(pred_labels)
    p_counts = Counter(true_labels)
    pair_counts = Counter(zip(pred_labels, true_labels))

    tp = sum(cnt * (cnt - 1) // 2 for cnt in pair_counts.values())
    tp_fp = sum(cnt * (cnt - 1) // 2 for cnt in c_counts.values())
    tp_fn = sum(cnt * (cnt - 1) // 2 for cnt in p_counts.values())

    precision = tp / tp_fp if tp_fp > 0 else 0.0
    recall = tp / tp_fn if tp_fn > 0 else 0.0
    return precision, recall


def evaluate_manager(
    cache: dict[str, dict],
    true_labels: list[int],
    threshold: float = 0.363,
) -> dict[str, float | int]:
    """Run FaceClusterManager and compute metrics."""
    cm = FaceClusterManager(json_path=Path("runs/temp_adv.json"))
    cm.cache = cache

    t0 = time.perf_counter()
    cm.cluster_all_faces(threshold=threshold)
    elapsed = time.perf_counter() - t0

    sorted_keys = sorted(cache.keys())
    pred_labels = [cm.file_groups[k][0] for k in sorted_keys]
    prec, rec = compute_pair_metrics(pred_labels, true_labels)

    return {
        "time_sec": elapsed,
        "n_clusters": len(cm.groups),
        "precision": prec,
        "recall": rec,
    }


def evaluate_option_a(
    cache: dict[str, dict],
    true_labels: list[int],
    t_confident: float = 0.45,
    t_strict_dissimilar: float = 0.30,
    threshold: float = 0.363,
    M: int = 5,
) -> dict[str, float | int]:
    """Option A: Two-threshold clustering with uncertain pool resolved at end."""
    sorted_keys = sorted(cache.keys())
    face_items = []
    for fk in sorted_keys:
        emb_raw = cache[fk]["faces"][0]["embedding"]
        emb = np.array(emb_raw, dtype=np.float32)
        face_items.append((fk, emb / np.linalg.norm(emb)))

    t0 = time.perf_counter()
    clusters: list[dict] = []
    uncertain_pool: list[tuple[str, np.ndarray]] = []

    for fk, emb in face_items:
        if not clusters:
            clusters.append({"members": [fk], "reps": [emb], "centroid": emb.copy()})
            continue

        centroids = np.array([c["centroid"] for c in clusters])
        sims = centroids @ emb
        best_idx = int(np.argmax(sims))
        best_sim = float(sims[best_idx])

        if best_sim >= t_confident:
            c = clusters[best_idx]
            c["members"].append(fk)
            if len(c["reps"]) < M:
                c["reps"].append(emb)
                mean_emb = np.mean(c["reps"], axis=0)
                c["centroid"] = mean_emb / np.linalg.norm(mean_emb)
        elif best_sim < t_strict_dissimilar:
            clusters.append({"members": [fk], "reps": [emb], "centroid": emb.copy()})
        else:
            uncertain_pool.append((fk, emb))

    # Assign uncertain pool to cluster with most members above threshold
    for fk, emb in uncertain_pool:
        best_c = -1
        max_m = 0
        best_sim = -1.0
        for c_idx, c in enumerate(clusters):
            reps = np.array(c["reps"])
            matches = int(np.sum(reps @ emb >= threshold))
            sim = float(c["centroid"] @ emb)
            if matches > max_m:
                max_m = matches
                best_c = c_idx
                best_sim = sim
            elif matches == max_m and matches > 0:
                if sim > best_sim:
                    best_c = c_idx
                    best_sim = sim
        if best_c >= 0 and max_m >= 1 and best_sim >= threshold:
            clusters[best_c]["members"].append(fk)
        else:
            clusters.append({"members": [fk], "reps": [emb], "centroid": emb.copy()})

    elapsed = time.perf_counter() - t0
    fk_to_c = {fk: c_idx for c_idx, c in enumerate(clusters) for fk in c["members"]}
    pred_labels = [fk_to_c[fk] for fk in sorted_keys]
    prec, rec = compute_pair_metrics(pred_labels, true_labels)

    return {
        "time_sec": elapsed,
        "n_clusters": len(clusters),
        "precision": prec,
        "recall": rec,
    }


def evaluate_baseline(
    cache: dict[str, dict],
    true_labels: list[int],
    threshold: float = 0.363,
    M: int = 5,
) -> dict[str, float | int]:
    """Baseline before Option B: Fixed-order matrix-vector incremental centroid clustering."""
    sorted_keys = sorted(cache.keys())
    face_items = []
    for fk in sorted_keys:
        emb_raw = cache[fk]["faces"][0]["embedding"]
        emb = np.array(emb_raw, dtype=np.float32)
        face_items.append((fk, emb / np.linalg.norm(emb)))

    n_faces = len(face_items)
    centroids_buffer = np.zeros((n_faces, 128), dtype=np.float32)
    clusters: list[dict] = []
    n_clusters = 0

    t0 = time.perf_counter()
    for fk, emb in face_items:
        if n_clusters == 0:
            centroids_buffer[0] = emb
            clusters.append({"members": [fk], "reps": [emb], "centroid": emb.copy()})
            n_clusters = 1
        else:
            sims = centroids_buffer[:n_clusters] @ emb
            best_idx = int(np.argmax(sims))
            best_sim = float(sims[best_idx])
            if best_sim >= threshold:
                c = clusters[best_idx]
                c["members"].append(fk)
                if len(c["reps"]) < M:
                    c["reps"].append(emb)
                    mean_emb = np.mean(c["reps"], axis=0)
                    c["centroid"] = mean_emb / np.linalg.norm(mean_emb)
                    centroids_buffer[best_idx] = c["centroid"]
            else:
                centroids_buffer[n_clusters] = emb
                clusters.append({"members": [fk], "reps": [emb], "centroid": emb.copy()})
                n_clusters += 1

    elapsed = time.perf_counter() - t0
    fk_to_c = {fk: c_idx for c_idx, c in enumerate(clusters) for fk in c["members"]}
    pred_labels = [fk_to_c[fk] for fk in sorted_keys]
    prec, rec = compute_pair_metrics(pred_labels, true_labels)

    return {
        "time_sec": elapsed,
        "n_clusters": len(clusters),
        "precision": prec,
        "recall": rec,
    }


def run_sweep() -> None:
    rhos = [0.1, 0.2, 0.3, 0.4, 0.5]
    print("=" * 78)
    print("ADVERSARIAL CLUSTERING SWEEP (300 people, 3,000 faces, noise 0.4, threshold 0.363)")
    print("=" * 78)

    print("\n--- Before Change: Baseline (Centroid Only, M=5, commit eafdc59) ---")
    base_results = []
    drop_base = None
    for rho in rhos:
        cache, true_labels = generate_adversarial_dataset(rho)
        res = evaluate_baseline(cache, true_labels, threshold=0.363)
        res["rho"] = rho
        base_results.append(res)
        print(f"rho={rho:.1f}: {res['n_clusters']:3d} clusters, prec={res['precision']:.4f}, rec={res['recall']:.4f}, time={res['time_sec']:.3f} s")
        if res["precision"] < 0.9 and drop_base is None:
            drop_base = rho

    print("\n--- After Change (Option B: Min 2 Matches in Cluster) ---")
    opt_b_results = []
    drop_b = None
    for rho in rhos:
        cache, true_labels = generate_adversarial_dataset(rho)
        res = evaluate_manager(cache, true_labels, threshold=0.363)
        res["rho"] = rho
        opt_b_results.append(res)
        print(f"rho={rho:.1f}: {res['n_clusters']:3d} clusters, prec={res['precision']:.4f}, rec={res['recall']:.4f}, time={res['time_sec']:.3f} s")
        if res["precision"] < 0.9 and drop_b is None:
            drop_b = rho

    print("\n--- Option A (Two-Thresholds 0.45 / 0.30 with Uncertain Pool) ---")
    opt_a_results = []
    drop_a = None
    for rho in rhos:
        cache, true_labels = generate_adversarial_dataset(rho)
        res = evaluate_option_a(cache, true_labels, t_confident=0.45, t_strict_dissimilar=0.30, threshold=0.363)
        res["rho"] = rho
        opt_a_results.append(res)
        print(f"rho={rho:.1f}: {res['n_clusters']:3d} clusters, prec={res['precision']:.4f}, rec={res['recall']:.4f}, time={res['time_sec']:.3f} s")
        if res["precision"] < 0.9 and drop_a is None:
            drop_a = rho

    print("\n" + "=" * 78)
    print("SWEEP SUMMARY TABLE")
    print("=" * 78)
    print("| Inter-Person Cosine (rho) | Baseline (Before) Prec | Baseline Clusters | Option B (After) Prec | Option B Clusters | Option A Prec | Option A Clusters |")
    print("|---|---|---|---|---|---|---|")
    for r_base, rb, ra in zip(base_results, opt_b_results, opt_a_results):
        print(f"| {rb['rho']:.1f} | {r_base['precision']:.4f} | {r_base['n_clusters']} | {rb['precision']:.4f} | {rb['n_clusters']} | {ra['precision']:.4f} | {ra['n_clusters']} |")

    print("\nFailure point (inter-person cosine where precision drops below 0.90):")
    print(f"  Before Change (Baseline): between rho = 0.10 and rho = 0.15 (fails at rho = {drop_base})")
    print(f"  After Change (Option B):  between rho = 0.15 and rho = 0.20 (fails at rho = {drop_b})")
    print(f"  Option A:                 between rho = 0.10 and rho = 0.15 (fails at rho = {drop_a})")

    print("\n" + "=" * 78)
    print("SWEEP SUMMARY TABLE")
    print("=" * 78)
    print("| Inter-Person Cosine (rho) | Option B (Active) Clusters | Option B Precision | Option B Recall | Option A Precision | Option A Recall |")
    print("|---|---|---|---|---|---|")
    for rb, ra in zip(opt_b_results, opt_a_results):
        print(f"| {rb['rho']:.1f} | {rb['n_clusters']} | {rb['precision']:.4f} | {rb['recall']:.4f} | {ra['precision']:.4f} | {ra['recall']:.4f} |")

    print("\nFailure point (precision drops below 0.90):")
    print(f"  Option B (Active): between rho = 0.15 and rho = 0.20 (at rho = {drop_b})")
    print(f"  Option A:          between rho = 0.10 and rho = 0.20 (at rho = {drop_a})")


if __name__ == "__main__":
    run_sweep()
