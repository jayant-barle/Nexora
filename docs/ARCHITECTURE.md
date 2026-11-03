# Architecture (planned)

This is the planned layout. Create folders only when a stage needs them.

Stage 1:
- nexora/names.py: name rule (extract the name from a file name)
- nexora/plan.py: builds the list of planned moves for the preview
- nexora/mover.py: verified move (same drive only), target naming and collisions
- nexora/undo.py: reads the run log and reverses a run
- nexora/ui.py: Tkinter window

Stage 2:
- nexora/metadata.py: reads the EXIF capture date from photos

Stage 3:
- nexora/faces/detect.py: YuNet face detection
- nexora/faces/recognize.py: SFace embeddings and matching
- nexora/faces/groups.py: groups faces and stores the owner's names

Other:
- models/: face model files (ONNX). Not committed. See the download notes in README.md.
- tests/: pytest tests, one file per module.
- VERSION and CHANGELOG.md: versioning.
