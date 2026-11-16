"""Tests for app.py selftest entry point."""

from app import run_selftest


def test_app_selftest() -> None:
    assert run_selftest() == 0
