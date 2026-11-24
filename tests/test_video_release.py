"""Test that video sampling releases cv2.VideoCapture on errors and failures (AGENTS.md Rule 4)."""

from pathlib import Path
import pytest

import nexora.faces.groups
from nexora.faces.groups import _worker_process_file, FaceClusterManager


def test_worker_video_sampling_releases_capture_on_read_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """When a frame read raises an exception during worker video sampling:

    1. cap.release() is called exactly once.
    2. The function returns without raising an exception.
    """
    clip = tmp_path / "clip.mp4"
    clip.write_bytes(b"corrupt video content")

    instances = []

    class FakeVideoCapture:
        def __init__(self, path: str) -> None:
            self.path = path
            self.release_called_count = 0
            instances.append(self)

        def isOpened(self) -> bool:
            return True

        def get(self, prop: int) -> float:
            return 100.0

        def set(self, prop: int, val: float) -> bool:
            return True

        def read(self):
            raise RuntimeError("Corrupt frame read error")

        def release(self) -> None:
            self.release_called_count += 1

    monkeypatch.setattr(nexora.faces.groups.cv2, "VideoCapture", FakeVideoCapture)

    # Call the worker video sampler
    task_args = (str(clip), True, clip.stat().st_size, "fake_sha", None, None)
    result = _worker_process_file(task_args)

    assert result["status"] == "could not read"
    assert len(instances) == 1, "VideoCapture should have been instantiated once"
    assert instances[0].release_called_count == 1, (
        f"Expected release() to be called exactly once, called {instances[0].release_called_count} times"
    )


def test_manager_video_sampling_releases_capture_on_read_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """When a frame read raises an exception during FaceClusterManager._process_video:

    1. cap.release() is called exactly once.
    2. The function returns without raising an exception.
    """
    clip = tmp_path / "clip.mp4"
    clip.write_bytes(b"corrupt video content")

    instances = []

    class FakeVideoCapture:
        def __init__(self, path: str) -> None:
            self.path = path
            self.release_called_count = 0
            instances.append(self)

        def isOpened(self) -> bool:
            return True

        def get(self, prop: int) -> float:
            return 100.0

        def set(self, prop: int, val: float) -> bool:
            return True

        def read(self):
            raise RuntimeError("Corrupt frame read error")

        def release(self) -> None:
            self.release_called_count += 1

    monkeypatch.setattr(nexora.faces.groups.cv2, "VideoCapture", FakeVideoCapture)

    manager = FaceClusterManager(tmp_path / "runs")
    res = manager._process_video(clip, clip.stat().st_size, "fake_sha", 0.363)

    assert res == 0
    assert len(instances) == 1, "VideoCapture should have been instantiated once"
    assert instances[0].release_called_count == 1, (
        f"Expected release() to be called exactly once, called {instances[0].release_called_count} times"
    )


def test_worker_video_sampling_releases_capture_when_not_opened(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """When cv2.VideoCapture.isOpened() returns False:

    1. cap.release() is called exactly once.
    2. The function returns without raising an exception.
    """
    clip = tmp_path / "unopened.mp4"
    clip.write_bytes(b"corrupt header")

    instances = []

    class FakeUnopenedVideoCapture:
        def __init__(self, path: str) -> None:
            self.path = path
            self.release_called_count = 0
            instances.append(self)

        def isOpened(self) -> bool:
            return False

        def release(self) -> None:
            self.release_called_count += 1

    monkeypatch.setattr(nexora.faces.groups.cv2, "VideoCapture", FakeUnopenedVideoCapture)

    task_args = (str(clip), True, clip.stat().st_size, "fake_sha", None, None)
    result = _worker_process_file(task_args)

    assert result["status"] == "could not read"
    assert len(instances) == 1
    assert instances[0].release_called_count == 1

