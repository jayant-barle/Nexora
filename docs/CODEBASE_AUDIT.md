# NEXORA — Codebase Audit & Dead-Code Evidence Report

Date: 2026-11-28  
Branch audited: `feature/magical-world-ui` (`64e775a`) vs `main` (`ab42c51`)  
Backup references created prior to cleanup:
- `backup/pre-audit-feature-20261128` -> `64e775a`
- `backup/pre-audit-main-20261128` -> `ab42c51`

---

## 1. Repository Scope & Runtime Data Preservation

- **Python application**: `app.py`, `nexora/` (`metadata.py`, `mover.py`, `names.py`, `plan.py`, `theme.py`, `ui.py`, `undo.py`), `nexora/faces/` (`detect.py`, `groups.py`, `people.py`, `recognize.py`, `suggestions.py`), `nexora/web/` (`app.py`, `bridge.py`).
- **Frontend**: `nexora/web/static/index.html`, `css/tokens.css`, `css/base.css`, `js/api.js`, `js/router.js`, `js/library.js`, `js/garden.js`, `assets/svg/{forest-scene,library-shelf,photo-garden}.svg`.
- **Infrastructure & scripts**: `tests/` (34 test modules), `scripts/` (7 CLI/diagnostic scripts), `requirements.txt`, `requirements-dev.txt`, `requirements.lock.txt`, `Nexora.spec`, `build/build_exe.bat`, `pytest.ini`.
- **Runtime / build data (untouched)**: `runs/` (`faces.json`, `crop_mapping.json`, `face_crops/`, scan logs, screenshot folders), `dist/Nexora.exe`, `build/`, `models/` ONNX weights. None of these are dead code and none are modified or removed.

---

## 2. Dead-Code & Unused-Symbol Evidence Table

### A. Verified Safe to Remove

| Item / Symbol | Location | Why Unused | Search Evidence & Ref Count | Dynamic / HTML / CSS / JS / Test / PyInstaller Check | Risk | Action |
|---|---|---|---|---|---|---|
| `import hashlib` | `nexora/faces/groups.py:5` | Replaced by `compute_sha256` from `nexora.mover` | `groups.py` count = 1; external imports from `groups` = 0 | Not in tests, scripts, HTML/JS, or `Nexora.spec` | Low | Remove |
| `DISMISSAL_OVERLAP_MIN`, `compute_pair_dismissal_key` | `nexora/faces/people.py:16-17` | Imported from `suggestions.py` but never referenced in `people.py` | Only in `suggestions.py` and `tests/test_merge_suggestions.py` (which imports from `suggestions.py`) | Not re-exported or imported from `people.py` | Low | Remove |
| `from typing import Any` | `nexora/faces/recognize.py:7` | Unused type import | `Any` count in `recognize.py` = 1 (import line only) | No external impact | Low | Remove |
| `import sys`, `Callable`, `validate_person_name` | `nexora/ui.py:6,11,21` | `ui.py` no longer calls `sys`, `Callable`, or `validate_person_name` directly (delegates to `PeopleManager.name_group`) | `validate_person_name` only in `people.py`, `ui.py:21`, and `test_people.py` | Not imported from `nexora.ui` by tests or `app.py` | Low | Remove |
| 19 legacy compatibility CSS tokens (`--nx-forest`, `--nx-forest-deep`, `--nx-leaf`, `--nx-leaf-bright`, `--nx-cream`, `--nx-cream-soft`, `--nx-wood`, `--nx-wood-dark`, `--nx-ink`, `--nx-sky`, `--nx-sky-soft`, `--nx-lavender`, `--nx-lavender-soft`, `--nx-gold`, `--nx-gold-warm`, `--nx-muted`, `--nx-accent-soft`, `--nx-surface-raised`, `--nx-glass-border`) | `nexora/web/static/css/tokens.css:27-55` | Leftover aliases from Living Treehouse & Obsidian Lavender themes; replaced by `--nx-card`, `--nx-accent`, `--nx-text-secondary`, `--nx-border` | 0 occurrences across `base.css`, `index.html`, `js/*.js`, and `tests/` | Not referenced dynamically or statically anywhere outside `tokens.css` | Low | Remove |
| Unused imports in `scripts/` & `tests/` (`cv2` in `face_diagnose.py`; `cosine_similarity`, `DEFAULT_THRESHOLD` in `compare_cluster_options.py`; `Counter`, `read_image_bgr`, `get_face_box_and_score`, `cosine_similarity` in `measure_faces.py`; `np`, `is_image_or_video`, `VIDEO_EXTENSIONS`, `cosine_similarity`, `REPRESENTATIVE_M`, `MIN_MEMBER_MATCHES` in `real_library_report.py`; unused test imports in `test_face_quality_metrics.py`, `test_faces_recognize.py`, `test_measure_labels.py`, `test_merge_name_persistence.py`, `test_merge_suggestions.py`, `test_metadata.py`, `test_people.py`, `test_regression_stage1_3.py`, `test_scan_reliability.py`, `test_split_persistence.py`) | `scripts/*.py`, `tests/*.py` | Stale imports left after prior refactors | AST + text count = 1 (import line only) inside each file | Only internal file scope; no test logic changed | Low | Remove |

### B. Intentionally Retained (Uncertain / Test-Referenced / Compatibility)

| Item / Symbol | Location | Why Retained | Reference Evidence | Risk if Removed | Action |
|---|---|---|---|---|---|
| `assets/svg/forest-scene.svg`, `library-shelf.svg`, `photo-garden.svg` | `nexora/web/static/assets/svg/` | Not referenced by current Dark 3D Glassmorphism HTML/CSS/JS, **but explicitly asserted by existing route tests** | `tests/test_web_bridge.py` lines 372, 395, 403 (`test_web_app_static_routes_and_media_token_security`) | Removing breaks existing test without modifying tests (prohibited by Phase 4 Rule 10) | **Retain** |
| `import pillow_heif` | `nexora/faces/detect.py:12` | Commented `# registers HEIF opener if installed`; retained per Phase 4 Rule 3 (do not alter face detection behavior) | `nexora/faces/detect.py:12` | Low/Uncertain on HEIC worker paths | **Retain** |
| `IMAGE_EXTENSIONS`, `MIN_FACE_SIZE`, `MAX_ASPECT_RATIO`, `cosine_similarity` imports | `nexora/faces/groups.py:20-35` | Potential module-attribute re-export compatibility (`scripts/real_library_report.py`, `nexora/web/bridge.py`, `tests/test_people_improvements.py`) | Cross-file symbol scan | Could break external scripts importing from `groups` | **Retain** |
| `NexoraBridgeApi` public methods & `runs/`, `dist/`, `models/` | `nexora/web/bridge.py`, runtime folders | Public bridge contracts (`build_preview`, `confirm_and_run_moves`, `list_activity_logs`, `execute_undo`) & user/build artifacts | `tests/test_web_bridge.py`, `Nexora.spec` | Breaking API / losing user data | **Retain** |

---

## 3. UI Integration Audit (Phase 5)

| Route (`data-room-panel`) | Implementation Status on `feature/magical-world-ui` | Backend / Bridge Wiring |
|---|---|---|
| `dashboard` (alias `treehouse`) | Complete Dark 3D Glassmorphism + Electric Lime UI, NEXORA orbital SVG logo, hover-only ambient lime card illumination, empty-workspace provenance notice, real-data gauges/charts | `get_app_state`, `get_main_hall_summary`, `pick_source_folder`, `pick_dest_folder`, `start_face_scan` |
| `main-hall` (Workspace Overview) | Complete workspace status rows & recent activity feed | `get_main_hall_summary` |
| `library` (File Explorer) | Complete top-level archive browser, search, category filter, server-side pagination, metadata inspector | `list_source_files`, `inspect_source_file`, `pick_source_folder` |
| `photo-garden` (Photos & People) | Complete people cards, scan controls, merge suggestions, guarded Name/Merge/Split modals, unreadable/withheld/no-faces reports, toast errors | `get_people_state`, `start_face_scan`, `name_group`, `split_group`, `merge_groups`, `dismiss_suggested_merge` |
| `crystal-chamber` (Safety & Restrictions) | Complete read-only safety policy disclosure | `get_crystal_chamber_status` |
| `potion-workshop` (File Organizer) | Placeholder panel ("Ready for migration after Dashboard review") | Underlying bridge APIs (`build_preview`, `confirm_and_run_moves`) implemented & tested; full interactive UI remains in `--classic` Tkinter |
| `memory-room` (Activity & History) | Placeholder panel ("Ready for migration after Dashboard review") | Underlying bridge API (`list_activity_logs`) implemented & tested; full log view available via Dashboard/Main Hall & `--classic` |
| `secret-vault` (Settings & Privacy) | Placeholder panel ("Ready for migration after Dashboard review") | Underlying bridge API (`execute_undo`) implemented & tested; full undo recovery available in `--classic` |
