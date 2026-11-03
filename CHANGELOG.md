# Changelog

## 0.3.0 (2026-11-04)
- Stage 2: Dates from image metadata.
  - Added capture date extraction reading EXIF DateTimeOriginal tag via Pillow.
  - HEIC dates via pillow-heif.
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
