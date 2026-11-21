# Test plan

## Stage 1: name rule, preview, verified move, undo
- [x] Name rule tests: nyc.jpg, nyc_2019_sunset.jpg, nyc_ali.jpg, camera prefixes, digit-only tokens, no name.
- [x] Move keeps SHA-256.
- [x] Name collision adds a suffix and overwrites nothing.
- [x] Undo restores every file in a run.
- [x] Cross-drive move is refused.
- [x] Owner test: run preview, Start and Undo on the test folder. Expected results are in the table below. Owner confirmed 2026-11-17: Preview, Start and Undo work.

## Stage 2: metadata dates for photos
- [x] Photo with EXIF date goes to YYYY/YYYY-MM.
- [x] Photo without EXIF date does not use file dates.
- [x] Owner test on the test folder. Owner confirmed 2026-11-17: Preview, Start and Undo work. HEIC images go to date folders.

## Stage 3: face recognition for photos (code complete, not accepted)
- [x] Face groups can be named by the owner.
- [x] Photo with no name and no date is matched to a named group.
- [x] Multi-person photo goes to Unsorted.
- [ ] Accuracy measured on a labelled test folder. Results recorded in docs/DECISIONS.md.

## Stage 4: People screen, person folders, group photos, approval (code complete, not accepted)
- [ ] Naming, merging and splitting face groups in people model.
- [ ] Person folder and Group photos placement rules (overriding name and date rules).
- [ ] Video frame sampling (5 frames, >=2 frames for face match).
- [ ] Scan cache skips unchanged files by SHA-256.
- [ ] People screen UI with face crop cards, naming, split and merge.
- [ ] Approve button with confirmation dialog, verified mover and log.
- [ ] Owner test on a copy of the library.

## Expected results (owner's test folder)
| File | Expected folder | Rule |
| --- | --- | --- |
| (to be filled in by the owner before the first run) | | |
