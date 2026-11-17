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

## Expected results (owner's test folder)
| File | Expected folder | Rule |
| --- | --- | --- |
| (to be filled in by the owner before the first run) | | |
