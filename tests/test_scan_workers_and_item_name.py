"""Tests for scan worker process safety, freeze_support, and item_name error handling."""

from __future__ import annotations

import ast
import inspect
import multiprocessing
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

import app
from nexora.faces.groups import FaceClusterManager
import nexora.ui as ui_module


def test_app_main_calls_freeze_support_source_check(tmp_path: Path):
    """Unit test: verify via AST source check that app.py calls multiprocessing.freeze_support() in __main__."""
    source = inspect.getsource(app)
    tree = ast.parse(source)

    # Find `if __name__ == "__main__":`
    main_if = None
    for node in tree.body:
        if isinstance(node, ast.If):
            # Check test condition: `__name__ == "__main__"`
            cond = node.test
            if isinstance(cond, ast.Compare):
                left = getattr(cond.left, "id", None)
                comps = [getattr(c, "value", None) for c in cond.comparators]
                if left == "__name__" and "__main__" in comps:
                    main_if = node
                    break

    assert main_if is not None, "Could not find `if __name__ == '__main__':` in app.py"

    # Verify that the first expression statement inside __main__ calls multiprocessing.freeze_support()
    first_stmt = main_if.body[0]
    assert isinstance(first_stmt, ast.Expr), f"Expected Expr as first statement in __main__, got {type(first_stmt)}"
    call_node = first_stmt.value
    assert isinstance(call_node, ast.Call), "Expected function call as first statement in __main__"
    
    # Check func is multiprocessing.freeze_support or freeze_support
    func = call_node.func
    if isinstance(func, ast.Attribute):
        assert func.attr == "freeze_support"
        assert getattr(func.value, "id", None) == "multiprocessing"
    elif isinstance(func, ast.Name):
        assert func.id == "freeze_support"
    else:
        pytest.fail(f"Unexpected call function: {ast.dump(func)}")


def test_worker_process_guard_prevents_ui_creation():
    """Guard test: a worker process (multiprocessing.current_process().name != 'MainProcess') must never create a UI window."""
    orig_name = multiprocessing.current_process().name
    try:
        multiprocessing.current_process().name = "NexoraScanWorker-9999"
        
        # 1. ui_module.main() must return immediately without creating tk.Tk()
        with patch("tkinter.Tk") as mock_tk:
            ui_module.main()
            assert mock_tk.call_count == 0, "main() must not create tk.Tk() in worker process"

        # 2. NexoraApp instantiation in a worker process must raise RuntimeError
        dummy_root = MagicMock()
        with pytest.raises(RuntimeError, match="Worker process must never create a UI window"):
            ui_module.NexoraApp(dummy_root)

    finally:
        multiprocessing.current_process().name = orig_name


def test_scan_handles_exception_before_assignment_without_unbound_local_error(tmp_path: Path):
    """Test BUG 2: an exception during future.result() or before assignment logs the file name and real error, NOT UnboundLocalError."""
    runs_dir = tmp_path / "runs"
    runs_dir.mkdir(parents=True, exist_ok=True)
    photos_dir = tmp_path / "photos"
    photos_dir.mkdir(parents=True, exist_ok=True)

    img_ok = photos_dir / "valid_image.jpg"
    img_ok.write_bytes(b"dummy image bytes ok")
    img_fail = photos_dir / "failing_image.jpg"
    img_fail.write_bytes(b"dummy image bytes fail")

    class MockFuture:
        def __init__(self, task_args: tuple):
            self.task_args = task_args

        def result(self):
            path_str = self.task_args[0]
            if "failing_image.jpg" in path_str:
                raise RuntimeError("Simulated worker exception before result assignment")
            return {
                "resolved_key": path_str,
                "type": "image",
                "size": len(self.task_args),
                "sha256": "fake_sha256_hash",
                "status": "ok",
                "faces": [],
            }

    class MockExecutor:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def submit(self, fn, task_args):
            return MockFuture(task_args)

    with patch("nexora.faces.groups.get_runs_dir", return_value=runs_dir):
        cm = FaceClusterManager(json_path=runs_dir / "faces.json")
        cm.load()

        with patch("nexora.faces.groups.ProcessPoolExecutor", MockExecutor), \
             patch("nexora.faces.groups.as_completed", side_effect=lambda futs: list(futs)):
            # Run scan in parallel mode (max_workers=2)
            cm.scan_source(source_dir=photos_dir, max_workers=2)

        # Scan should complete without raising UnboundLocalError
        # Verify scan log file was generated
        log_files = list(runs_dir.glob("scan-*.log"))
        assert len(log_files) == 1, "Expected exactly one scan log file"

        log_content = log_files[0].read_text(encoding="utf-8")

        # Must log error with real file name and real error message
        assert "error, failing_image.jpg, 0 faces, Simulated worker exception before result assignment" in log_content
        # Must NOT contain UnboundLocalError
        assert "UnboundLocalError" not in log_content
        # Summary line should reflect 1 error
        assert "errors: 1" in log_content

