"""Comparison script for FIX 1: Evaluating clustering representative options.

Compares:
Option 1: Full centroid (running mean of all members, updated on every join).
Option 2: Frozen representative (first M=5 members, frozen after 5 members).

Evaluated across:
(a) Adversarial sweep (300 people, 3,000 faces, noise 0.4, rho in [0.1, 0.2, 0.3, 0.4, 0.5]).
(b) Well-separated case (1,000 people, 10,000 faces, noise 0.3).
(c) Varied pose case (50 people, 40 faces/person = 2,000 faces, per-face offset 0.3 along random direction).
"""

from __future__ import annotations

import sys
import time
from collections import Counter
from pathlib import Path
from typing import Any
import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from nexora.faces.recognize import cosine_similarity, DEFAULT_THRESHOLD
from nexora.faces.suggestions import MERGE_SUGGEST_THRESHOLD


def _unit_vec(rng: np.random.Generator, dim: int = 128) -> np.ndarray:
    v = rng.standard_normal(dim).astype(np.float32)
    norm = np.linalg.norm(v)
    return v / norm if norm > 0 else v


def compute_pair_metrics(pred_labels: list[int | str], true_labels: list[int]) -> tuple[float, float]:
    c_counts = Counter(pred_labels)
    p_counts = Counter(true_labels)
    pair_counts = Counter(zip(pred_labels, true_labels))

    tp = sum(cnt * (cnt - 1) // 2 for cnt in pair_counts.values())
    tp_fp = sum(cnt * (cnt - 1) // 2 for cnt in c_counts.values())
    tp_fn = sum(cnt * (cnt - 1) // 2 for cnt in p_counts.values())

    precision = tp / tp_fp if tp_fp > 0 else 0.0
    recall = tp / tp_fn if tp_fn > 0 else 0.0
    return precision, recall


def count_inconsistent_pairs(centroids: np.ndarray, threshold: float = MERGE_SUGGEST_THRESHOLD) -> int:
    """Count pairs of cluster centroids with cosine similarity >= threshold."""
    k = len(centroids)
    if k <= 1:
        return 0
    # centroids is (k, 128) normalized
    sim_matrix = centroids @ centroids.T
    # upper triangle without diagonal
    triu_indices = np.triu_indices(k, k=1)
    sims = sim_matrix[triu_indices]
    return int(np.sum(sims >= threshold))


def cluster_dataset(
    face_embeddings: list[np.ndarray],
    mode: str,  # "full_centroid" or "frozen_m5"
    threshold: float = 0.363,
    min_member_matches: int = 2,
    M: int = 5,
) -> tuple[list[int], np.ndarray, float]:
    """Cluster face embeddings using either full centroid or frozen M=5 representative."""
    t0 = time.perf_counter()
    n_faces = len(face_embeddings)
    if n_faces == 0:
        return [], np.zeros((0, 128), dtype=np.float32), 0.0

    centroids_buffer = np.zeros((n_faces, 128), dtype=np.float32)
    clusters: list[dict[str, Any]] = []
    n_clusters = 0

    for idx, emb in enumerate(face_embeddings):
        if n_clusters == 0:
            centroids_buffer[0] = emb
            clusters.append({
                "members": [idx],
                "rep_members": [emb],
                "sum_emb": emb.copy(),
                "centroid": emb.copy(),
            })
            n_clusters = 1
        else:
            sims = centroids_buffer[:n_clusters] @ emb
            candidate_indices = np.where(sims >= threshold)[0]
            best_idx = -1
            best_sim = -1.0

            if len(candidate_indices) > 0:
                for c_idx in candidate_indices:
                    c = clusters[c_idx]
                    reps = c["rep_members"]
                    if len(reps) < min_member_matches:
                        if sims[c_idx] > best_sim:
                            best_sim = float(sims[c_idx])
                            best_idx = int(c_idx)
                    else:
                        reps_mat = np.array(reps)
                        matches = int(np.sum(reps_mat @ emb >= threshold))
                        if matches >= min_member_matches:
                            if sims[c_idx] > best_sim:
                                best_sim = float(sims[c_idx])
                                best_idx = int(c_idx)

            if best_idx >= 0:
                c = clusters[best_idx]
                c["members"].append(idx)
                c["sum_emb"] += emb
                cnt = len(c["members"])

                if mode == "full_centroid":
                    # Update centroid as running mean of ALL members
                    mean_emb = c["sum_emb"] / cnt
                    norm = np.linalg.norm(mean_emb)
                    new_centroid = (mean_emb / norm) if norm > 0 else mean_emb
                    c["centroid"] = new_centroid
                    centroids_buffer[best_idx] = new_centroid
                    if len(c["rep_members"]) < M:
                        c["rep_members"].append(emb)
                elif mode == "frozen_m5":
                    # Update centroid only for first M members, then freeze
                    if len(c["rep_members"]) < M:
                        c["rep_members"].append(emb)
                        mean_emb = np.mean(c["rep_members"], axis=0)
                        norm = np.linalg.norm(mean_emb)
                        new_centroid = (mean_emb / norm) if norm > 0 else mean_emb
                        c["centroid"] = new_centroid
                        centroids_buffer[best_idx] = new_centroid
            else:
                centroids_buffer[n_clusters] = emb
                clusters.append({
                    "members": [idx],
                    "rep_members": [emb],
                    "sum_emb": emb.copy(),
                    "centroid": emb.copy(),
                })
                n_clusters += 1

    elapsed = time.perf_counter() - t0
    pred_labels = [0] * n_faces
    for c_id, c in enumerate(clusters):
        for m in c["members"]:
            pred_labels[m] = c_id

    final_centroids = np.array([c["centroid"] for c in clusters], dtype=np.float32)
    return pred_labels, final_centroids, elapsed


def run_adversarial_sweep(mode: str) -> list[dict[str, Any]]:
    results = []
    rng_master = np.random.default_rng(42)
    for rho in [0.1, 0.2, 0.3, 0.4, 0.5]:
        b = _unit_vec(rng_master)
        n_people = 300
        faces_per_person = 10
        embs = []
        true_labels = []

        for p in range(n_people):
            v_p = _unit_vec(rng_master)
            v_p = v_p - float(v_p @ b) * b
            v_p /= np.linalg.norm(v_p)
            c_p = np.sqrt(rho) * b + np.sqrt(1.0 - rho) * v_p
            c_p /= np.linalg.norm(c_p)

            for i in range(faces_per_person):
                noise = _unit_vec(rng_master)
                f_emb = c_p + 0.4 * noise
                f_emb /= np.linalg.norm(f_emb)
                embs.append(f_emb)
                true_labels.append(p)

        pred_labels, centroids, elapsed = cluster_dataset(embs, mode=mode)
        prec, rec = compute_pair_metrics(pred_labels, true_labels)
        inconsistent = count_inconsistent_pairs(centroids)
        results.append({
            "rho": rho,
            "precision": prec,
            "recall": rec,
            "clusters": len(centroids),
            "inconsistent": inconsistent,
            "time_sec": elapsed,
        })
    return results


def run_well_separated_case(mode: str) -> dict[str, Any]:
    rng = np.random.default_rng(42)
    n_people = 1000
    faces_per_person = 10

    embs = []
    true_labels = []
    for p in range(n_people):
        cp = _unit_vec(rng)
        for _ in range(faces_per_person):
            noise = 0.3 * _unit_vec(rng)
            f_emb = cp + noise
            f_emb /= np.linalg.norm(f_emb)
            embs.append(f_emb)
            true_labels.append(p)

    pred_labels, centroids, elapsed = cluster_dataset(embs, mode=mode)
    prec, rec = compute_pair_metrics(pred_labels, true_labels)
    inconsistent = count_inconsistent_pairs(centroids)
    return {
        "n_faces": len(embs),
        "n_people": n_people,
        "precision": prec,
        "recall": rec,
        "clusters": len(centroids),
        "inconsistent": inconsistent,
        "time_sec": elapsed,
    }


def run_varied_pose_case(mode: str) -> dict[str, Any]:
    rng = np.random.default_rng(999)
    n_people = 50
    faces_per_person = 40
    centers = rng.standard_normal((n_people, 128), dtype=np.float32)
    centers /= np.linalg.norm(centers, axis=1, keepdims=True)

    embs = []
    true_labels = []
    for p in range(n_people):
        c_p = centers[p]
        for _ in range(faces_per_person):
            # simulate varied pose: per-face offset of 0.3 along a random direction
            rand_dir = _unit_vec(rng)
            f_emb = c_p + 0.3 * rand_dir
            f_emb /= np.linalg.norm(f_emb)
            embs.append(f_emb)
            true_labels.append(p)

    pred_labels, centroids, elapsed = cluster_dataset(embs, mode=mode)
    prec, rec = compute_pair_metrics(pred_labels, true_labels)
    inconsistent = count_inconsistent_pairs(centroids)
    return {
        "n_faces": len(embs),
        "n_people": n_people,
        "precision": prec,
        "recall": rec,
        "clusters": len(centroids),
        "inconsistent": inconsistent,
        "time_sec": elapsed,
    }


def main():
    print("=" * 80)
    print("COMPARING CLUSTERING REPRESENTATIVE OPTIONS:")
    print("Option 1: Full Centroid (running mean of all members)")
    print("Option 2: Frozen Representative (frozen after first M=5 members)")
    print("=" * 80)

    for name, mode in [("Option 1: Full Centroid", "full_centroid"), ("Option 2: Frozen M=5", "frozen_m5")]:
        print(f"\n--- {name} ---")
        
        # Test A: Adversarial Sweep
        print("\n(a) Adversarial Sweep (3,000 faces, 300 people, noise 0.4):")
        adv_res = run_adversarial_sweep(mode)
        print(f"{'rho':<6} | {'Precision':<10} | {'Recall':<10} | {'Clusters':<10} | {'Inconsistent Pairs':<18} | {'Time (s)':<10}")
        print("-" * 75)
        for r in adv_res:
            print(f"{r['rho']:<6.1f} | {r['precision']:<10.4f} | {r['recall']:<10.4f} | {r['clusters']:<10} | {r['inconsistent']:<18} | {r['time_sec']:<10.4f}")

        # Test B: Well-separated Case
        print("\n(b) Well-separated Case (10,000 faces, 1,000 people, noise 0.3):")
        ws_res = run_well_separated_case(mode)
        print(f"  Precision:          {ws_res['precision']:.4f}")
        print(f"  Recall:             {ws_res['recall']:.4f}")
        print(f"  Clusters:           {ws_res['clusters']} (target ~1000)")
        print(f"  Inconsistent Pairs: {ws_res['inconsistent']} (target 0)")
        print(f"  Time:               {ws_res['time_sec']:.3f} s")

        # Test C: Varied Pose Case
        print("\n(c) Varied Pose Case (2,000 faces, 50 people, 40 faces/person, offset 0.3):")
        vp_res = run_varied_pose_case(mode)
        print(f"  Precision:          {vp_res['precision']:.4f}")
        print(f"  Recall:             {vp_res['recall']:.4f}")
        print(f"  Clusters:           {vp_res['clusters']} (target 50)")
        print(f"  Inconsistent Pairs: {vp_res['inconsistent']}")
        print(f"  Time:               {vp_res['time_sec']:.3f} s")


if __name__ == "__main__":
    main()
