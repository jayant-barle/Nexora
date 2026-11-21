# Changelog

## 0.5.4-dev (2026-11-22)
- Merge suggestions on People screen: suggests pairs of visible groups with cosine similarity >= 0.363 (MERGE_SUGGEST_THRESHOLD, unmeasured default). Suggestions are sorted by similarity descending and capped at 50 (MAX_MERGE_SUGGESTIONS). Pairs already sharing the same name or previously dismissed are excluded.
- Stable dismissal tracking with overlap rule: fixed dismissal resilience so dismissed pairs remain dismissed after rescans even when groups gain or lose faces (e.g. earlier file names joining). Stored dismissals record up to 10 member IDs per group and match when more than half (> 50%, DISMISSAL_OVERLAP_MIN = 0.5 unmeasured default) of stored members persist in the current groups. Old exact-key dismissal records remain supported for backwards compatibility.
- Consistency alignment between clustering and merge suggestions: both clustering and merge suggestions compare against the same representative frozen after the first M=5 members (MAX_REPRESENTATIVE_MEMBERS = 5), eliminating drift while maintaining 1.0 precision and recall on varied poses. Added post-clustering consistency check (count_inconsistent_pairs) asserting 0 inconsistent pairs on well-separated synthetic benchmarks.
- Real library diagnostic runner (scripts/real_library_report.py): manual standalone script outside pytest that performs non-destructive profiling, cryptographic SHA-256 verification across all files, EXIF date diagnostics vs file mtime, review views for large groups, and ground-truth template generation.
- Enforced AGENTS.md Rule 4: automated test in tests/test_safety.py fails if any test under tests/ attempts to read external or real photo paths.
- Labelling template confidentiality: runs/chulmati_labels_template.csv outputs file, face_index, crop_path, person (blank) without leaking cluster IDs or suggested names.
- People screen UI: added "Suggested merges" section above group cards with side-by-side preview crops, names, photo counts, similarity scores, "Merge" button (invokes existing merge_groups), and "Not the same person" button (persists dismissal). Displays "No suggested merges." when empty and indicates when the 50-suggestion cap is reached.
- Large group review view: groups flagged needs_review report sample crop paths and file counts in real-library reports for owner review.
- Safety: suggestions never merge or alter files automatically; user-approved merges follow existing plan placement rules.
- Accuracy not yet measured on real photos. Owner review pending.

## 0.5.3-dev (2026-11-22)
- Progress file versioning: schema_version 2 in runs/faces.json with automatic in-place migration preserving cache and names. Corrupt files are backed up to runs/faces.corrupt-<timestamp>.json, reported in the status bar, and scan starts clean. Atomic writes (.tmp -> fsync -> os.replace) preserved every 50 files and on stop/error/finish.
- Per-scan log: each scan writes runs/scan-<YYYYMMDD-HHMMSS>.log recording one line per file (status, file name, faces found, reason if not ok) and an end summary line (total files, ok, cached, could-not-read, no-faces, errors, elapsed seconds).
- Unreadable files tracking: unreadable files tracked in runs/faces.json under "unreadable", cleared when later successfully read. People screen includes read-only "Unreadable files (N)" viewer.
- Accuracy not yet measured on real photos. Owner review pending.

## 0.5.2-dev (2026-11-22)
- Labelled evaluation script scripts/measure_faces.py enhanced with cosine similarity histograms (same-person vs different-person), accuracy/recall/precision/FPR tables, and false merge file lists; outputs formatted runs/measure_report.txt and exits cleanly without fake numbers when no dataset exists.
- Stopped synthetic sweeps; retained MIN_MEMBER_MATCHES = 2 at threshold 0.363 as unmeasured default pending owner review on real photos.
- People screen transparency: shows placement status on group cards and displays a dedicated section showing photos withheld from placement and why (needs review, unnamed, or hidden group). Placement rules remain unchanged.
- Restored placement order so unnamed faces, hidden 1-face groups, and false faces never block name or date rules.
- Incremental centroid clustering on cosine similarity (threshold 0.363 default) comparing against normalized cluster centroids via matrix-vector dot products; deterministic, shuffle-invariant, and near-linear.
- Centroid drift mitigation: cluster comparison representatives frozen after first M=5 members (MAX_REPRESENTATIVE_MEMBERS = 5), eliminating chaining collapse across faces.
- Multi-member match safeguard (Option B): require a new face to match at least 2 members of an established cluster (MIN_MEMBER_MATCHES = 2) at threshold 0.363 before joining, preventing stranger faces from merging clusters.
- Giant cluster safeguard: clusters exceeding cap (min(5% of faces, 200)) labeled "large group: name it to use it" on the People screen and withheld from automatic placement until named or split.
- Name persistence across re-clustering: names stored by member face in runs/faces.json.
- Visibility threshold set to 2: clusters with 2+ faces visible as "Unnamed person N"; 1-face clusters stay hidden and ignored by placement (unmeasured default, owner review pending).
- Accuracy measurement script scripts/measure_faces.py added for pairwise precision/recall/FPR evaluation across thresholds 0.6, 0.7, 0.85.
- Clustering benchmark scripts scripts/benchmark_cluster.py and scripts/adversarial_cluster.py added to measure time, peak memory, and accuracy sweeps across inter-person cosines 0.1 to 0.5.
- Accuracy not yet measured. Owner review pending.

## 0.5.1-dev (2026-11-21)
- Faster scan (1280px, parallel workers), fewer false faces (score 0.85, min size 48px on 1280px, shape filter, min group size 3), progress saved during scan. Accuracy not yet measured. Owner review pending.

## 0.5.0-dev (2026-11-21)
- People screen, person and group-photo folders, scan across all images and video frames, Approve step.

## 0.4.1-dev (2026-11-17)
- Face detection: orientation fix, multi-scale, rotation, lower threshold and minimum size.

## 0.4.0-dev (2026-11-17)
- Face recognition code. Not accepted until accuracy is measured.

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
