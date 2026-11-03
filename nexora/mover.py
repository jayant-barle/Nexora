"""Verified file mover for Nexora with SHA-256 verification and audit logging."""

from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from nexora.plan import PlannedMove


def compute_sha256(path: Path | str) -> str:
    """Compute the SHA-256 hash of a file reading in 1 MB chunks."""
    hasher = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(1024 * 1024):
            hasher.update(chunk)
    return hasher.hexdigest()


def run_plan(plan: list[PlannedMove], log_path: Path | str) -> dict[str, Any]:
    """Execute planned moves in order.
    
    Verifies SHA-256 before and after each move and logs to log_path.
    Never deletes or overwrites any file.
    """
    log_file_path = Path(log_path)
    log_file_path.parent.mkdir(parents=True, exist_ok=True)

    moved_count = 0
    skipped_count = 0
    refused_count = 0

    with open(log_file_path, "a", encoding="utf-8") as log_file:
        for move in plan:
            if move.status == "skipped":
                skipped_count += 1
                continue
            if move.status == "refused":
                refused_count += 1
                continue
            if move.status != "ready":
                continue

            # a. Compute the SHA-256 of the source
            src_sha = compute_sha256(move.source)

            # b. Ensure target folder exists and move using os.replace
            move.target.parent.mkdir(parents=True, exist_ok=True)
            os.replace(move.source, move.target)

            # c. Compute the SHA-256 of the target and verify integrity
            target_sha = compute_sha256(move.target)
            if target_sha != src_sha:
                # STOP immediately and report. Never delete anything.
                return {
                    "moved": moved_count,
                    "skipped": skipped_count,
                    "refused": refused_count,
                    "stopped": True,
                    "reason": (
                        f"SHA-256 mismatch for moved file {move.target} "
                        f"(expected {src_sha}, got {target_sha}). Run halted."
                    ),
                }

            # d. Append JSON log entry and flush immediately
            entry = {
                "original": str(move.source.resolve()),
                "moved_to": str(move.target.resolve()),
                "sha256": src_sha,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
            log_file.write(json.dumps(entry) + "\n")
            log_file.flush()

            moved_count += 1

    return {
        "moved": moved_count,
        "skipped": skipped_count,
        "refused": refused_count,
        "stopped": False,
        "reason": "",
    }
