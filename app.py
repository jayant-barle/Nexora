"""Launch script for Nexora."""

from __future__ import annotations

import multiprocessing
import sys
import tempfile
from pathlib import Path

from nexora.plan import build_plan
from nexora.mover import run_plan
from nexora.undo import undo_run
from nexora.ui import main


def run_selftest() -> int:
    """Run an automated self-test without GUI.
    
    Creates temporary folders, plans moves, executes verified moves,
    validates target placements, reverses moves via undo, and verifies restorations.
    Returns 0 on success, 1 on failure.
    """
    try:
        with tempfile.TemporaryDirectory() as src_dir, tempfile.TemporaryDirectory() as dst_dir, tempfile.TemporaryDirectory() as log_dir:
            src_path = Path(src_dir)
            dst_path = Path(dst_dir)
            log_path = Path(log_dir) / "run.log"

            sample_files = [
                "nyc.jpg",
                "nyc_2019_sunset.jpg",
                "IMG_2034.jpg",
                "paris_eiffel_tower.mp4",
                "notes.txt",
            ]
            for fn in sample_files:
                (src_path / fn).write_bytes(b"sample content for selftest")

            plan = build_plan(src_path, dst_path)
            summary = run_plan(plan, log_path)

            if summary.get("stopped"):
                print(f"SELFTEST FAIL: run stopped - {summary.get('reason')}")
                return 1

            # Check moved files landed where name rule says
            if not (dst_path / "nyc" / "nyc.jpg").exists():
                print("SELFTEST FAIL: nyc.jpg not in dest/nyc/")
                return 1
            if not (dst_path / "nyc" / "nyc_2019_sunset.jpg").exists():
                print("SELFTEST FAIL: nyc_2019_sunset.jpg not in dest/nyc/")
                return 1
            if not (dst_path / "Unsorted" / "IMG_2034.jpg").exists():
                print("SELFTEST FAIL: IMG_2034.jpg not in dest/Unsorted/")
                return 1
            if not (dst_path / "paris" / "paris_eiffel_tower.mp4").exists():
                print("SELFTEST FAIL: paris_eiffel_tower.mp4 not in dest/paris/")
                return 1
            if not (src_path / "notes.txt").exists():
                print("SELFTEST FAIL: notes.txt was moved instead of skipped")
                return 1

            # Run undo
            undo_summary = undo_run(log_path)
            if undo_summary.get("restored") != 4:
                print(f"SELFTEST FAIL: undo restored {undo_summary.get('restored')} files, expected 4")
                return 1

            # Check files are back in source
            for fn in sample_files:
                if not (src_path / fn).exists():
                    print(f"SELFTEST FAIL: {fn} not restored to source")
                    return 1

            print("SELFTEST PASS")
            return 0
    except Exception as e:
        print(f"SELFTEST FAIL: {e}")
        return 1


if __name__ == "__main__":
    multiprocessing.freeze_support()
    if multiprocessing.current_process().name != "MainProcess":
        sys.exit(0)
    if "--selftest" in sys.argv:
        sys.exit(run_selftest())
    main()
