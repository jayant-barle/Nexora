"""Test error handling in move worker thread (AGENTS.md Rule 4)."""

import os
from pathlib import Path
import threading
import tkinter as tk
from unittest.mock import MagicMock
import pytest

from nexora.plan import build_plan
from nexora.ui import NexoraApp


def test_move_worker_thread_error_handling(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """When run_plan raises OSError on the second file, the UI handles the error gracefully.
    
    Verifies that:
    1. Buttons are re-enabled (preview button normal, is_running reset to False)
    2. An error message is shown (messagebox.showerror called, status bar updated)
    3. The progress bar is reset (unpacked from UI)
    """
    try:
        root = tk.Tk()
    except Exception as e:
        pytest.skip(f"Tkinter unavailable: {e}")

    try:
        root.withdraw()

        src = tmp_path / "src"
        dst = tmp_path / "dst"
        runs = tmp_path / "runs"
        src.mkdir(parents=True)
        dst.mkdir(parents=True)
        runs.mkdir(parents=True)

        # Create two files so the second one fails during move
        (src / "nyc_01.jpg").write_bytes(b"test content file 1")
        (src / "nyc_02.jpg").write_bytes(b"test content file 2")

        monkeypatch.setattr("nexora.ui.get_runs_dir", lambda: runs)
        monkeypatch.setattr("nexora.faces.groups.get_runs_dir", lambda: runs)

        app = NexoraApp(root)
        app.source_dir.set(str(src))
        app.dest_dir.set(str(dst))

        # Generate a plan with ready moves
        app.current_plan = build_plan(src, dst)
        ready_moves = [m for m in app.current_plan if m.status == "ready"]
        assert len(ready_moves) == 2, f"Expected 2 ready moves, got {len(ready_moves)}"

        app._set_preview_button_state(True)
        app._set_approve_button_state(True)

        # Monkeypatch mover: raise OSError on the second file
        orig_replace = os.replace
        replace_count = 0

        def mock_replace(s, d):
            nonlocal replace_count
            replace_count += 1
            if replace_count == 2:
                raise OSError("Simulated disk I/O error moving second file")
            return orig_replace(s, d)

        monkeypatch.setattr("nexora.mover.os.replace", mock_replace)

        # Confirm dialog returns True
        monkeypatch.setattr("nexora.ui.messagebox.askyesno", lambda *args, **kwargs: True)

        # Mock showerror to observe error display and unblock mainloop
        mock_showerror = MagicMock()

        def on_showerror(title, msg):
            mock_showerror(title, msg)
            root.quit()

        monkeypatch.setattr("nexora.ui.messagebox.showerror", on_showerror)

        # Track worker threads
        threads = []
        orig_thread_init = threading.Thread.__init__

        def mock_thread_init(self, *args, **kwargs):
            orig_thread_init(self, *args, **kwargs)
            threads.append(self)

        monkeypatch.setattr(threading.Thread, "__init__", mock_thread_init)

        # Safety timer to exit mainloop if worker hangs or crashes
        root.after(1000, root.quit)

        # Start the approve flow the same way the UI does
        app._on_approve_click()

        # Run event loop to process background thread callbacks
        root.mainloop()

        for t in threads:
            t.join(timeout=1.0)

        # Assert: the buttons are re-enabled
        assert not app.is_running, "app.is_running must be reset to False after error"
        assert str(app.preview_btn["state"]) in ("normal", tk.NORMAL), "Preview button must be re-enabled"
        assert str(app.start_btn["state"]) in ("disabled", tk.DISABLED), "Start button must be disabled after failed run"

        # Assert: an error message is shown
        assert mock_showerror.called, "messagebox.showerror must be called when move fails with an exception"
        assert "error" in app.status_var.get().lower() or "failed" in app.status_var.get().lower()

        # Assert: the progress bar is reset
        assert not app.progress_bar.winfo_manager(), "Progress bar must be reset (unpacked) after error"

    finally:
        root.destroy()
