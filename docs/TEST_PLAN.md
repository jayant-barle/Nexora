# Test plan

## Stage 1: name rule, preview, verified move, undo
- [x] Name rule tests: nyc.jpg, nyc_2019_sunset.jpg, nyc_ali.jpg, camera prefixes, digit-only tokens, no name.
- [x] Move keeps SHA-256.
- [x] Name collision adds a suffix and overwrites nothing.
- [x] Undo restores every file in a run.
- [x] Cross-drive move is refused.
- [ ] Owner test: run preview, Start and Undo on the test folder. Expected results are in the table below.

## Stage 2: metadata dates for photos
- [x] Photo with EXIF date goes to YYYY/YYYY-MM.
- [x] Photo without EXIF date does not use file dates.
- [ ] Owner test on the test folder.

## Stage 3: face recognition for photos
- [ ] Face groups can be named by the owner.
- [ ] Photo with no name and no date is matched to a named group.
- [ ] Multi-person photo goes to Unsorted.
- [ ] Accuracy measured on a labelled test folder. Results recorded in docs/DECISIONS.md.

## Expected results (owner's test folder)
| File | Expected folder | Rule |
| --- | --- | --- |
| (to be filled in by the owner before the first run) | | |
