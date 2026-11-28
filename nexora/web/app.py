"""PyWebView EdgeChromium host application and local HTTP asset server for Nexora."""

from __future__ import annotations

import mimetypes
import multiprocessing
from pathlib import Path
import sys
from typing import Any

import bottle

from nexora.web.bridge import NexoraBridgeApi

# Ensure standard MIME types regardless of Windows Registry overrides
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("image/svg+xml", ".svg")


def get_static_dir() -> Path:
    """Resolve static frontend directory across dev and PyInstaller frozen builds."""
    if hasattr(sys, "_MEIPASS"):
        candidate = Path(sys._MEIPASS) / "nexora" / "web" / "static"
        if candidate.exists():
            return candidate
    if getattr(sys, "frozen", False):
        candidate = Path(sys.executable).resolve().parent / "nexora" / "web" / "static"
        if candidate.exists():
            return candidate
    return Path(__file__).resolve().parent / "static"


def create_web_app(bridge: NexoraBridgeApi, static_dir: Path | None = None) -> bottle.Bottle:
    """Create the local Bottle WSGI application serving Nexora's HTML/CSS/JS/SVG UI.

    Security notes:
    - Root and static assets resolve strictly under `static_dir`.
    - `/api/media` enforces BOTH a per-session CSPRNG token and Python's
      directory allowlist (`bridge.is_allowed_media_path`).
    """
    resolved_static = (static_dir or get_static_dir()).resolve()
    app = bottle.Bottle()

    @app.route("/")
    def serve_index() -> Any:
        return bottle.static_file("index.html", root=str(resolved_static))

    @app.route("/static/<filepath:path>")
    def serve_static(filepath: str) -> Any:
        return bottle.static_file(filepath, root=str(resolved_static))

    @app.route("/api/media")
    def serve_media() -> Any:
        token = bottle.request.query.get("token", "")
        raw_path = bottle.request.query.get("path", "")
        if not token or token != bridge.session_token:
            bottle.abort(403, "Invalid session token.")
        if not raw_path or not bridge.is_allowed_media_path(raw_path):
            bottle.abort(403, "Access denied.")
        try:
            data = bridge.render_media_jpeg(raw_path)
            bottle.response.content_type = "image/jpeg"
            bottle.response.set_header("Cache-Control", "private, max-age=120")
            return data
        except Exception as err:
            bottle.abort(404, f"Unable to render media: {err}")

    return app


def main_web(headless_probe_callback: Any | None = None) -> None:
    """Launch Nexora Magical World desktop window via PyWebView (EdgeChromium)."""
    if multiprocessing.current_process().name != "MainProcess":
        return

    import webview

    bridge = NexoraBridgeApi()
    wsgi_app = create_web_app(bridge)

    hidden = headless_probe_callback is not None
    window = webview.create_window(
        "Nexora",
        wsgi_app,
        js_api=bridge,
        width=1240,
        height=820,
        min_size=(940, 640),
        background_color="#080909",
        hidden=hidden,
    )
    bridge.attach_window(window)

    if headless_probe_callback is not None:
        webview.start(headless_probe_callback, window, gui="edgechromium")
    else:
        webview.start(gui="edgechromium")
