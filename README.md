# Nexora

A Windows desktop app that sorts a large library of images and videos into folders. It finds people in your photos, lets you name them, and moves files only after you approve a preview. Nothing is copied or deleted.

> **Status:** test build. Name, date, preview and undo accepted; reliability, merge suggestions and the merge guard built; accuracy on real photos unmeasured; pass 2 off by default.

## What it does

| Feature | Status |
| --- | --- |
| Sort by name in the file name (for example `nyc_2019.jpg` goes to `nyc/`) | Accepted |
| Sort images by the date stored in their metadata, including HEIC (`2023/2023-05/`) | Accepted |
| Preview every move before anything happens | Accepted |
| Undo the whole last run | Accepted |
| Scan reliability: progress checkpoints, per-scan logging, unreadable files dialog | Built |
| Find faces and cluster them into people | Built (accuracy on real photos unmeasured) |
| People screen: name, split, and merge with size guard confirmation | Built |
| Merge suggestions with stable dismissals | Built |
| Person folders, group photos folder, approval step | Built |
| Second merge pass (iterative full-centroid clustering) | Built (disabled by default) |

## How it decides where each file goes

**Images**, in this order, first match wins:

1. **One known person** → `<Person>/`
2. **Two or more known people** → `Group photos/`
3. **A name in the file name** → `<name>/`
4. **A date in the image's metadata** → `<YYYY>/<YYYY-MM>/`
5. **Otherwise** → `Unsorted/`

**Videos**:

1. **A known person appears in at least 2 of 5 sampled frames** → `<Person>/`
2. **A name in the file name** → `<name>/`
3. **Otherwise** → `Unsorted/`

Camera names such as `IMG_`, `DSC_` and `VID_` and generic words such as `copy`, `final` and `photo` are not treated as names. Full rules are in [PRD.md](PRD.md).

## Safety

- **Preview first.** Nothing moves until you press Approve.
- **Move, not copy.** Originals are moved, not duplicated.
- **Never deletes.** The app has no delete step.
- **Never overwrites.** A clashing name gets a number added.
- **Checksums.** Each file's SHA-256 is checked before and after the move. A mismatch stops the run.
- **Undo.** Every move is logged, so the last run can be reversed.
- **Same drive only.** Moves across drives are refused.
- **Face data stays on your PC.** Face groups are saved in `runs/`, which is never committed.

## Requirements

- Windows 10 or 11
- Python 3.11 or newer (only needed to run from source)

## Run from source

```bat
py -3.11 -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

## Build the Windows test app

```bat
build\build_exe.bat
```

The single-file app is written to `dist\Nexora.exe`. It is not code-signed, so Windows may show a warning. Choose **More info**, then **Run anyway**.

Check the build with:

```bat
dist\Nexora.exe --selftest
```

It should print `SELFTEST PASS`.

## Test

```bat
pytest -v
```

Tests use temporary folders. No test reads or writes real photos. One test is skipped unless the owner's labelled folder is present in `tests/faces_labelled/`.

## Face models and scripts

Face detection and recognition use two OpenCV models, which are not stored in this repo:

- `face_detection_yunet_2023mar.onnx` (YuNet, detection)
- `face_recognition_sface_2021dec.onnx` (SFace, recognition)

Both are Apache 2.0. Download them with:

```bat
python scripts\download_models.py
```

The script checks each file's SHA-256 hash.

### Measuring accuracy

To measure face clustering accuracy against labelled data (when available in `tests/faces_labelled/`):

```bat
python scripts\measure_faces.py
```

Prints pairwise cosine similarity distributions and precision/recall metrics, or exits cleanly with status when no labelled dataset is present.

### Real library telemetry

To profile a real photo folder without modifying, moving, or deleting any files:

```bat
python scripts\real_library_report.py "C:\path\to\library"
```

Computes cryptographic SHA-256 checksums before and after the run to verify integrity, audits EXIF dates, scans and clusters faces, and prints merge suggestion diagnostics. Add `--pass2` to evaluate optional Pass 2 clustering.

## Project layout

```
app.py                 Window and entry point
nexora/
  names.py             Name rule
  plan.py              Placement rules and preview
  mover.py             Verified move and run log
  undo.py              Undo
  metadata.py          Capture dates (EXIF, HEIC)
  theme.py             Colours and fonts
  ui.py                Window
  faces/
    detect.py          Face detection
    recognize.py       Face embeddings and matching
    groups.py          Scanning and grouping
    people.py          Naming, merging, splitting
    suggestions.py     Merge suggestions and stable dismissals
scripts/               Model download, evaluation, and diagnostic tools
  download_models.py   Download face models
  measure_faces.py     Accuracy measurement script
  real_library_report.py Real library profiling script
tests/                 Tests
docs/                  Test plan, architecture, decisions
PRD.md                 Product requirements
AGENTS.md              Rules for contributors and tooling
```

## Documentation

- [PRD.md](PRD.md): what the app should do and why
- [docs/TEST_PLAN.md](docs/TEST_PLAN.md): acceptance checklist for each stage
- [docs/DECISIONS.md](docs/DECISIONS.md): decisions and their dates
- [CHANGELOG.md](CHANGELOG.md): version history
- [AGENTS.md](AGENTS.md): rules for working on this repo

## Licence

Not yet decided. Add a LICENSE file before sharing this repo publicly.
