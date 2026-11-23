# Changelog

## 0.5.5-dev (2026-11-24)
- People screen search and filter: added a search entry above group cards that filters dynamically by display name, folder name, "unnamed", or "large group" / "needs review" (case-insensitive). Keywords match whole words or phrases on queries with 2+ characters; single-character queries match assigned names only to prevent loose keyword false-positives. Empty query displays all groups; non-matching queries display an informative message.
- People screen sort options: added a dropdown with four sorting modes: "Largest first" (default), "Smallest first", "Name A-Z", and "Needs review first".
- Large group workflow: naming a `needs_review` group through the standard `PeopleManager.name_group` path clears its review flag, saves the update to `faces.json`, and activates its placement in subsequent Preview plans.
- Worker process multiprocessing safety: added `multiprocessing.freeze_support()` at the very top of `if __name__ == "__main__":` in `app.py` and `nexora/ui.py`. In PyInstaller packaged executables on Windows, worker processes spawned by `ProcessPoolExecutor` now properly initialize in worker mode rather than re-running the GUI and opening multiple windows.
- Worker process Tk window guard: added an explicit process check (`multiprocessing.current_process().name != "MainProcess"`) in `nexora/ui.py` (`main()` returns immediately, `NexoraApp` raises `RuntimeError`) and `_worker_init` explicitly names scan workers (`NexoraScanWorker-<pid>`), ensuring a worker process can never create a Tk window or UI components.
- Scan exception logging robustness (item_name fix): in `nexora/faces/groups.py`, `item_name` is computed from the file task path before the `try:` block begins. If a worker task or future raises an exception during execution, the exception handler accesses `item_name` safely, logging the exact error message and file name without raising `UnboundLocalError`.
- Accuracy on real photos: unmeasured, pending owner's labelled folder.

## 0.5.4-dev (2026-11-22)
- Merge suggestions on People screen: suggests pairs of visible groups with cosine similarity >= 0.363 (MERGE_SUGGEST_THRESHOLD, unmeasured default). Suggestions are sorted by similarity descending and capped at 50 (MAX_MERGE_SUGGESTIONS). Pairs already sharing the same name or previously dismissed are excluded.
- Stable dismissal tracking with overlap rule: fixed dismissal resilience so dismissed pairs remain dismissed after rescans even when groups gain or lose faces (e.g. earlier file names joining). Stored dismissals record up to 10 member IDs per group and match when more than half (> 50%, DISMISSAL_OVERLAP_MIN = 0.5 unmeasured default) of stored members persist in the current groups. Old exact-key dismissal records remain supported for backwards compatibility.
- People screen UI: added "Suggested merges" section above group cards with side-by-side preview crops, names, photo counts, similarity scores, "Merge" button, and "Not the same person" button (persists dismissal). Displays "No suggested merges." when empty and indicates when the 50-suggestion cap is reached.
- Merge size ratio guard: restricted to automatic merges (such as Pass 2) via `is_automatic=True`, preventing a cluster with 3 or fewer faces from absorbing a cluster more than twice its size (`MERGE_GUARD_SMALL_CLUSTER_MAX = 3`, `MERGE_GUARD_MAX_RATIO = 2.0`). Manual merges from the People screen (`is_automatic=False`) are allowed, and prompt confirmation ("This merges N faces into a group of M faces. Continue?") when the guard condition is met.
- Pass 2 disabled by default (`PASS2_ENABLED = False`): full-centroid iterative merge pass is disabled by default in production clustering while preserving all code for diagnostic and research runs (`--pass2` in `scripts/real_library_report.py`).
- Consistency alignment between clustering and merge suggestions: both clustering and merge suggestions compare against the same representative frozen after the first M=5 members (MAX_REPRESENTATIVE_MEMBERS = 5), eliminating drift while maintaining 1.0 precision and recall on varied poses. Added post-clustering consistency check (count_inconsistent_pairs) asserting 0 inconsistent pairs on well-separated synthetic benchmarks.
- Second merge pass evaluation: optional iterative full-centroid merge pass at threshold 0.363 capped at large-group limit and requiring at least one small cluster (<= 5 members). Synthetic recall across sweep table (Option 2 + Pass 2, noise 0.4): 0.9909 at rho=0.1, 0.8373 at rho=0.2, 0.4636 at rho=0.3, 0.5733 at rho=0.4, 0.7088 at rho=0.5; passes collapse case (pair precision >= 0.9) and well-separated regression benchmarks.
- Error direction analysis & known limitations: documented in DECISIONS.md that Option 2 (frozen M=5) errs on the side of under-merging rather than over-merging to prevent drift and collapse across people, with recall cost evaluated across the adversarial sweep (recall 0.8373 at rho=0.2, 0.4636 at rho=0.3). Known limitation documented: precision falls below 0.9 at inter-person similarity around 0.12 (baseline) and around 0.16 (current), and drops sharply above 0.3.
- Real library diagnostic runner (scripts/real_library_report.py): manual standalone script outside pytest that performs non-destructive profiling, cryptographic SHA-256 verification across all files, EXIF date diagnostics vs file mtime, review views for large groups, and ground-truth template generation.
- Neutral crop naming and template confidentiality: face crops in runs/face_crops/ renamed to neutral sequential names (crop_000123.jpg) with mapping stored separately in runs/crop_mapping.json. Ground-truth template (runs/chulmati_labels_template.csv) lists every detected face (one row per face) with blank person column, completely free of 'group_' or any cluster IDs, enforced by automated tests.
- Strict Rule 4 automated enforcement: added AST test in tests/test_safety.py asserting that any automated test function accessing files via open(), read_text(), read_bytes(), or os.scandir operates strictly on paths rooted in pytest's tmp_path fixture.
- Large group review view: groups flagged needs_review report sample crop paths and file counts in real-library reports for owner review.
- Safety: suggestions never merge or alter files automatically; user-approved merges follow existing plan placement rules.
- Accuracy on real photos: unmeasured, pending owner's labelled folder.

## 0.5.3-dev (2026-11-22)
- Progress file versioning: schema_version 2 in runs/faces.json with automatic in-place migration preserving cache and names. Corrupt files are backed up to runs/faces.corrupt-<timestamp>.json, reported in the status bar, and scan starts clean. Atomic writes (.tmp -> fsync -> os.replace) preserved every 50 files and on stop/error/finish.
- Per-scan log: each scan writes runs/scan-<YYYYMMDD-HHMMSS>.log recording one line per file (status, file name, faces found, reason if not ok) and an end summary line (total files, ok, cached, could-not-read, no-faces, errors, elapsed seconds).
- Unreadable files tracking: unreadable files tracked in runs/faces.json under "unreadable", cleared when later successfully read. People screen includes read-only "Unreadable files (N)" viewer.
- Accuracy on real photos: unmeasured, pending owner's labelled folder.

## 0.5.2-dev (2026-11-22)
- Placement order strictly restored so unnamed faces, hidden 1-face groups, and false faces never block name or date rules.
- Incremental centroid clustering on cosine similarity (threshold 0.363 default) comparing against normalized cluster centroids via matrix-vector dot products; deterministic, shuffle-invariant, and near-linear.
- Centroid drift mitigation: cluster comparison representatives frozen after first M=5 members (MAX_REPRESENTATIVE_MEMBERS = 5), eliminating chaining collapse across faces.
- Multi-member match safeguard (Option B): require a new face to match at least 2 members of an established cluster (MIN_MEMBER_MATCHES = 2) at threshold 0.363 before joining, preventing stranger faces from merging clusters.
- Giant cluster safeguard: clusters exceeding cap (min(5% of faces, 200)) labeled "large group: name it to use it" on the People screen and withheld from automatic placement until named or split.
- People screen transparency: shows placement status on group cards and displays a dedicated section showing photos withheld from placement and why (needs review, unnamed, or hidden group). Placement rules remain unchanged.
- Name persistence across re-clustering: names stored by member face in runs/faces.json.
- Visibility threshold set to 2: clusters with 2+ faces visible as "Unnamed person N"; 1-face clusters stay hidden and ignored by placement (MIN_VISIBLE_GROUP_SIZE = 2, unmeasured default).
- Labelled evaluation script scripts/measure_faces.py enhanced with cosine similarity histograms (same-person vs different-person), accuracy/recall/precision/FPR tables, and false merge file lists; outputs formatted runs/measure_report.txt and exits cleanly without fake numbers when no dataset exists.
- Clustering benchmark scripts scripts/benchmark_cluster.py and scripts/adversarial_cluster.py added to measure time, peak memory, and accuracy sweeps across inter-person cosines 0.1 to 0.5.
- Stopped synthetic sweeps; retained MIN_MEMBER_MATCHES = 2 at threshold 0.363 as unmeasured default.
- Accuracy on real photos: unmeasured, pending owner's labelled folder.

## 0.5.1-dev (2026-11-21)
- Faster scan (1280px, parallel workers), fewer false faces (score 0.85, min size 48px on 1280px, shape filter, min group size 3), progress saved during scan.
- Accuracy on real photos: unmeasured, pending owner's labelled folder.

## 0.5.0-dev (2026-11-21)
- People screen, person and group-photo folders, scan across all images and video frames, Approve step.

## 0.4.1-dev (2026-11-17)
- Face detection: orientation fix, multi-scale, rotation, lower threshold and minimum size.

## 0.4.0-dev (2026-11-17)
- Face recognition code. Not accepted until accuracy on real photos is measured, pending owner's labelled folder.

## 0.3.2 (2026-11-17)
- UI polish: Windows theme, cards, colour-coded counts, table styling. No behaviour change.

## 0.3.1 (2026-11-17)
- Windows test build (single .exe), self-test flag.

## 0.3.0 (2026-11-04)
- Stage 2: Dates from image metadata.
  - Added capture date extraction reading EXIF DateTimeOriginal tag via Pillow.
  - HEIC dates via pillow-heif.
  - HEIC test now fails on real errors instead of skipping.
  - Updated plan builder to place unnamed images into YYYY/YYYY-MM folders by capture date.
  - Added tests for EXIF extraction, missing EXIF, non-images, and filesystem timestamp independence.

## 0.2.1 (2026-11-04)
- Ignore generic words (photo, pic, copy, new, final, untitled, download, video, clip, film) and filler words such as of, the, and, a, to when choosing a name.

## 0.2.0 (2026-11-04)
- Stage 1: Name rule, preview, verified move, and undo.
  - Added name extraction rule with camera token stripping and Windows reserved name safety.
  - Added pure plan builder with collision resolution and path safety validation.
  - Added verified file mover using os.replace with pre/post SHA-256 integrity verification.
  - Added reverse undo engine with undone.json guard.
  - Added Tkinter/ttk desktop GUI with asynchronous background operations.
  - Added full pytest test suite for Stage 1.

## 0.1.0 (2026-11-04)
- Project setup: PRD, rules, docs and configuration. No application code yet.
