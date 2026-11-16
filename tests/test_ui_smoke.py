"""Smoke test for Nexora UI layout and initial state."""

import pytest
import tkinter as tk

from nexora.ui import NexoraApp


def test_ui_smoke():
    """Verify UI layout builder, initial button states, and exact footer text."""
    try:
        root = tk.Tk()
    except Exception as e:
        pytest.skip(f"Tkinter cannot initialize in this environment: {e}")

    try:
        root.withdraw()
        app = NexoraApp(root)

        # Check Preview, Start and Undo exist
        assert hasattr(app, "preview_btn"), "Preview button must exist on app"
        assert hasattr(app, "start_btn"), "Start button must exist on app"
        assert hasattr(app, "undo_btn"), "Undo button must exist on app"

        # Check Start is disabled at start
        assert str(app.start_btn["state"]) in ("disabled", tk.DISABLED), "Start button must be disabled at start"

        # Check footer text is exactly as specified
        assert hasattr(app, "footer_label"), "Footer label must exist on app"
        expected_footer = "Files are moved, not copied. Nothing is deleted."
        assert app.footer_label.cget("text") == expected_footer, f"Footer text mismatch: {app.footer_label.cget('text')}"
    finally:
        root.destroy()
