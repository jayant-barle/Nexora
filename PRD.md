# Nexora: Product Requirements (PRD)

Status: Draft, confirmed with the owner on 2026-11-03/04. Items marked **(default)** were not explicitly chosen by the owner and are open to change.

## 1. Purpose

A Windows desktop app that sorts a large local library of images and videos (about 11,000+ files) into folders. Each file is moved, one at a time, into a folder named after a person or place found in its file name, or by date or face where needed.

## 2. Users

One user: the owner, on their own Windows PC.

## 3. Scope

### In scope
- Images and videos on local drives.
- Folder selection by the user for source and destination.
- Name rule for images and videos.
- Date rule for images only (from metadata).
- Face recognition for images only, and only when an image has neither a name nor a metadata date.
- Preview before any move.
- Undo for a whole run.

### Out of scope
- Dashboards, search, timeline, events, storage analysis, duplicate detection.
- OCR, image classification, local LLMs.
- Watched folders and background indexing.
- Cloud storage or network drives (for now).
- Copying files. Files are moved.
- Deleting files.

## 4. Placement rules

### 4.1 Images (in order, first match wins)

1. **Name in the file name.**
   - Remove the extension.
   - Split on `_`, `-`, `.`, space and digits.
   - Ignore camera tokens (case-insensitive): `IMG`, `DSC`, `VID`, `MOV`, `Screenshot`, `WhatsApp`, `Image`.
   - Ignore tokens that are only digits.
   - The first remaining word is the name, in lowercase. It becomes the folder name.
   - Windows reserved names (`con`, `prn`, `aux`, `nul`, `com1`-`com9`, `lpt1`-`lpt9`) are not names. **(default)**
   - Examples: `nyc.jpg` goes to `nyc/`. `nyc_2019_sunset.jpg` goes to `nyc/`. `nyc_ali.jpg` goes to `nyc/`.
2. **Metadata date.** The image's capture date (EXIF DateTimeOriginal) sorts it into `<YYYY>/<YYYY-MM>/`. **(default format)**
   - File created and modified dates are never used.
3. **Face recognition.** Used only when rules 1 and 2 don't apply.
   - The app groups similar faces. The owner names each group once.
   - The image goes into the folder of the matching group.
   - An image showing several people goes into `Unsorted/`.
4. **Otherwise** the image goes into `Unsorted/`.

### 4.2 Videos

1. **Name in the file name.** Same name rule as images.
2. **Otherwise** `Unsorted/`.

Videos never use metadata dates or face recognition.

### 4.3 Two names in one file

The first name wins. `nyc_ali.jpg` goes to `nyc/`.

### 4.4 Other files

Files that are not images or videos are skipped. They are listed in the preview and never moved. **(default)**

## 5. Safety requirements

- **Move, not copy.** Files are moved from the source folder to the destination.
- **Never delete.** The app never deletes a file.
- **Never overwrite.** If a target name exists, a numeric suffix is added.
- **Preview first.** The user sees every planned move before anything moves.
- **Verify.** Each file's SHA-256 is computed before and after the move. If they differ, the run stops and reports the file.
- **Same drive only (stage 1).** If the source and destination are on different drives, the move is refused. Cross-drive moves need a separate decision.
- **Undo.** Every move is written to a log file (original path, new path, SHA-256, timestamp). Undo reverses the whole last run using that log. If an original path is now taken, undo stops and reports it.
- **Top-level scan only (stage 1).** Only the files directly in the source folder are scanned. Subfolders are skipped. **(default)**
- **Destination inside source is refused.** **(default)**

## 6. User interface

A simple Windows window (Tkinter).

- Pick source folder.
- Pick destination folder.
- **Preview** button: shows a table with columns Source, Destination, Matched by, Size.
- **Start** button: enabled only after a preview. Runs the moves.
- **Undo** button: reverses the last run.
- Footer text: "Files are moved, not copied. Nothing is deleted."

Face-group naming (stage 3) adds a simple screen where the owner names each group. **(default)**

## 7. Technical requirements

- Python 3.11 or newer. **(default)**
- Libraries: OpenCV (face detection and recognition), Pillow (metadata), pytest (tests). Tkinter comes with Python.
- Face models: YuNet (detection) and SFace (recognition), ONNX format, CPU only.
- No database. Run state is kept in a JSON log file next to the app.
- Windows 10 or 11.

## 8. Build stages

1. **Stage 1: name rule.** Preview, verified move, undo log, `Unsorted/`. Tests for every rule and safety requirement.
2. **Stage 2: metadata dates for images.** EXIF tests with real and missing EXIF.
3. **Stage 3: face recognition for images.** Face grouping, naming, matching, and multi-person handling. Accuracy is measured on a labelled test folder before the stage is accepted.

Each stage ends with a stop-and-report step.

## 9. Acceptance

A stage is accepted when:
- All its tests pass.
- Running it on the owner's test folder places every file where the expected-results list says.
- The owner has tried the preview, Start and Undo on that folder.

## 10. Open items

- **Folder name case:** lowercase is the default. Owner to confirm.
- **Date folder format:** `<YYYY>/<YYYY-MM>/` is the default. Owner to confirm.
- **Subfolders:** top-level only is the default. Owner to confirm.
- **Face match threshold:** set by testing on the owner's images in stage 3. Not chosen yet.
- **Undo scope:** whole run is the default. Single-move undo is not planned.
- **Cross-drive moves:** not supported in stage 1.
- **Speed:** face recognition on 11,000+ files may take hours. To be measured in stage 3.
