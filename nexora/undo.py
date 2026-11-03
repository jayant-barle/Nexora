"""Undo engine for Nexora run logs."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from nexora.mover import compute_sha256


def undo_run(log_path: Path | str) -> dict[str, Any]:
    """Reverse a previous run from its log file.
    
    Processes moves in reverse order.
    Refuses to run if undone.json already exists next to log_path.
    Never deletes any user files or folders.
    """
    log_file_path = Path(log_path)
    if not log_file_path.exists():
        raise FileNotFoundError(f"Run log does not exist: {log_path}")

    undone_path = log_file_path.parent / "undone.json"
    if undone_path.exists():
        raise RuntimeError("Undo refused: this run has already been undone (undone.json exists).")

    entries: list[dict[str, Any]] = []
    with open(log_file_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                entries.append(json.loads(line))

    restored_count = 0
    skipped_entries: list[dict[str, str]] = []
    missing_entries: list[dict[str, str]] = []
    mismatched_entries: list[dict[str, str]] = []

    # Process in reverse order
    for entry in reversed(entries):
        orig_path = Path(entry["original"])
        moved_path = Path(entry["moved_to"])
        expected_sha = entry["sha256"]

        if not moved_path.exists():
            missing_entries.append({
                "moved_to": str(moved_path),
                "original": str(orig_path),
                "reason": "Moved file is missing on disk",
            })
            continue

        if orig_path.exists():
            skipped_entries.append({
                "moved_to": str(moved_path),
                "original": str(orig_path),
                "reason": "Original destination path is already occupied",
            })
            continue

        # Recreate original parent folder if needed
        orig_path.parent.mkdir(parents=True, exist_ok=True)
        os.replace(moved_path, orig_path)

        restored_sha = compute_sha256(orig_path)
        if restored_sha != expected_sha:
            mismatched_entries.append({
                "original": str(orig_path),
                "expected": expected_sha,
                "actual": restored_sha,
            })
        else:
            restored_count += 1

    summary = {
        "undone_at": datetime.now(timezone.utc).isoformat(),
        "log_path": str(log_file_path.resolve()),
        "restored": restored_count,
        "skipped": len(skipped_entries),
        "missing": len(missing_entries),
        "mismatched": len(mismatched_entries),
        "skipped_entries": skipped_entries,
        "missing_entries": missing_entries,
        "mismatched_entries": mismatched_entries,
    }

    undone_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    return summary
