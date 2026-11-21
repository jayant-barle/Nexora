# Nexora: Product Requirements (PRD)

Version: 2.0 (2026-11-21). Confirmed with the owner. Items marked **(default)** were not explicitly chosen by the owner and are open to change.

## 1. Purpose

A Windows desktop app that sorts a large local library of images and videos (about 11,000+ files) into folders. The app finds the people in the library, lets the owner name them, and moves files into folders only after the owner approves a preview.

## 2. Users

One user: the owner, on their own Windows PC.

## 3. Scope

### In scope
- Images and videos on local drives.
- Folder selection by the user for source and destination.
- Name rule for images and videos.
- Date rule for images (from metadata).
- Face detection and grouping across all images and across a few frames of each video.
- A People screen where the owner names, merges and splits face groups.
- A preview of every planned move, and one Approve step before anything moves.
- Undo for a whole run.

### Out of scope
- Dashboards, search, timeline, events, storage analysis, duplicate detection.
- OCR, image classification, local LLMs.
- Watched folders and background indexing.
- Cloud storage or network drives (for now).
- Copying files. Files are moved.
- Deleting files.

## 4. Placement rules

Each file is placed by the first rule that applies.

### 4.1 Images

1. **One known person.** The image shows exactly one face that belongs to a named person. It goes into `<Person>/`.
2. **Two or more known people.** The image shows two or more faces that belong to different named people. It goes into `Group photos/`. **(default: this overrides the name rule)**
3. **Name in the file name.** The name becomes the folder, using the name rule (section 4.3).
4. **Metadata date.** The image's capture date (EXIF DateTimeOriginal) sorts it into `<YYYY>/<YYYY-MM>/`.
5. **Otherwise** `Unsorted/`.

Rule 1 overrides the name and date rules. Example: `nyc_ali.jpg` with a known person Ali goes to `ali/`, not `nyc/`.

An image that shows an unnamed person goes to `Unsorted/` until that person is named. Unnamed people are listed on the People screen as "Unnamed person 1", "Unnamed person 2", and so on.

### 4.2 Videos

1. **Known person in the video.** A few frames are checked. If one named person appears in at least 2 of the sampled frames, the video goes into `<Person>/`. **(default: 5 frames spaced evenly through the video)** **(default: a person beats a name, the same as for images)**
2. **Name in the file name.** The name rule applies.
3. **Otherwise** `Unsorted/`.

Videos never use metadata dates.

### 4.3 Name rule (file names)

- Remove the extension.
- Split on `_`, `-`, `.`, space and digits.
- Ignore camera tokens (case-insensitive): `IMG`, `DSC`, `VID`, `MOV`, `Screenshot`, `WhatsApp`, `Image`.
- Ignore generic words: `photo`, `photos`, `pic`, `pics`, `picture`, `copy`, `new`, `final`, `untitled`, `download`, `downloads`, `video`, `clip`, `film`.
- Ignore filler words: `of`, `the`, `and`, `a`, `an`, `to`, `in`, `on`, `at`, `for`, `with`, `from`.
- Ignore tokens that are only digits.
- Lowercase the first remaining word. It is the name.
- Windows reserved names (`con`, `prn`, `aux`, `nul`, `com1`-`com9`, `lpt1`-`lpt9`) are not names.
- The first name wins: `nyc_ali.jpg` goes to `nyc/` when Ali is not a known person.

### 4.4 Other files

Files that are not images or videos are skipped. They are listed in the preview and never moved.

## 5. Faces and people

- **Detection** runs on every image and on sampled frames of every video.
- **Grouping** clusters similar faces into groups. Each group is one person until it is named.
- **Naming.** The owner names a group once. Several groups can share one name, which merges them.
- **Splitting.** If a group mixes two people, the owner can split it.
- **Accuracy.** Matching thresholds are set by testing on the owner's labelled folder before the feature is accepted.

## 6. Safety requirements

- **Approve before moving.** No file moves until the owner presses Approve on the preview.
- **Move, not copy.** Files are moved from the source folder to the destination.
- **Never delete.** The app never deletes a file.
- **Never overwrite.** If a target name exists, a numeric suffix is added.
- **Verify.** Each file's SHA-256 is computed before and after the move. If they differ, the run stops and reports the file.
- **Same drive only.** If the source and destination are on different drives, the move is refused. Cross-drive moves need a separate decision.
- **Undo.** Every move is written to a log file (original path, new path, SHA-256, timestamp). Undo reverses the whole last run using that log. If an original path is now taken, undo stops and reports it.
- **Top-level scan only.** Only files directly in the source folder are scanned. Subfolders are skipped. **(default)**
- **Destination inside source is refused.**
- **Face data stays local.** Face groups and embeddings are stored in `runs/`, which is git-ignored, and are never committed or sent anywhere.

## 7. User interface

A simple Windows window (Tkinter), built with the Nexora visual style.

### Folders and actions
- Pick source folder. Pick destination folder.
- **Scan people** button: runs in the background with a progress bar. Can be stopped and resumed.
- **Preview** button: shows every planned move, with columns Source, Destination, Matched by, Size.
- **Approve** button: enabled only after a preview. Runs the moves.
- **Undo** button: reverses the last run.
- Footer text: "Files are moved, not copied. Nothing is deleted."

### People screen
- One card per person group, with sample face crops.
- Name box and Save. Saving the same name for two groups merges them.
- Split button for a group that mixes two people.
- Groups with no name are listed as "Unnamed person N".

## 8. Technical requirements

- Python 3.11 or newer. **(default)**
- Libraries: OpenCV (face detection and recognition), Pillow (metadata and images), pillow-heif (HEIC images), pytest (tests). Tkinter comes with Python.
- Face models: YuNet (detection) and SFace (recognition), ONNX format, CPU only, Apache 2.0 licence.
- No database. Run state and face data are kept in files in `runs/`.
- Windows 10 or 11.
- Packaged as a single Windows .exe for testing.

## 9. Build stages

1. **Stage 1: name rule, preview, verified move, undo.** Accepted.
2. **Stage 2: image dates from metadata, including HEIC.** Accepted.
3. **Stage 3: face detection and grouping.** Code complete. Accepted after accuracy is measured on the owner's labelled folder.
4. **Stage 4: People screen, person folders, group photos, approval.** Built on stage 3. Accepted after the owner runs it on a copy of the library.

Each stage ends with a stop-and-report step.

## 10. Acceptance

A stage is accepted when:
- All its tests pass.
- The owner has run it on a copy of their files, and the results match the expected-results list.
- For stage 3, the accuracy numbers on the labelled folder are recorded and the threshold is chosen from them.

## 11. Open items

- **Frames per video:** 5 is the default. Owner to confirm.
- **Multi-person rule vs. name:** `Group photos/` overrides the name. Owner to confirm.
- **Unnamed people:** stay in `Unsorted/` until named. Owner to confirm.
- **Labelled folder:** needed before stage 3 is accepted. Not yet provided.
- **Face match threshold:** chosen from the labelled folder. Not yet chosen.
- **Speed:** scanning all images and video frames may take many hours. To be measured on a small folder first.
- **Folder name case:** lowercase is the default.
- **Date folder format:** `<YYYY>/<YYYY-MM>/` is the default.
- **Subfolders:** top-level only is the default.
