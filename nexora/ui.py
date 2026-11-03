"""Tkinter GUI for Nexora."""

from __future__ import annotations

import os
import threading
from datetime import datetime
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from nexora.plan import PlannedMove, build_plan
from nexora.mover import run_plan
from nexora.undo import undo_run


def format_size(size_bytes: int) -> str:
    """Format file size in human-readable units."""
    if size_bytes < 1024:
        return f"{size_bytes} B"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    else:
        return f"{size_bytes / (1024 * 1024):.1f} MB"


def get_runs_dir() -> Path:
    """Get the runs directory path next to app.py."""
    return Path(__file__).resolve().parent.parent / "runs"


def find_latest_active_run_log() -> Path | None:
    """Find the latest run log that has not been undone."""
    runs_dir = get_runs_dir()
    if not runs_dir.exists():
        return None

    run_dirs = sorted([d for d in runs_dir.iterdir() if d.is_dir()], key=lambda d: d.name, reverse=True)
    for rdir in run_dirs:
        log_file = rdir / "run.log"
        undone_file = rdir / "undone.json"
        if log_file.exists() and not undone_file.exists():
            return log_file
    return None


class NexoraApp:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("Nexora")
        self.root.geometry("960x640")
        self.root.minsize(750, 480)

        self.source_dir = tk.StringVar()
        self.dest_dir = tk.StringVar()
        self.count_var = tk.StringVar(value="Select folders and click Preview to begin.")
        self.status_var = tk.StringVar(value="Ready")

        self.current_plan: list[PlannedMove] = []
        self.is_running = False

        self._build_ui()
        self.update_undo_button_state()

    def _build_ui(self) -> None:
        # Style configuration
        style = ttk.Style(self.root)
        try:
            style.theme_use("clam")
        except Exception:
            pass

        main_frame = ttk.Frame(self.root, padding=12)
        main_frame.pack(fill=tk.BOTH, expand=True)

        # Folder Selection Frame
        folder_frame = ttk.LabelFrame(main_frame, text="Folders", padding=10)
        folder_frame.pack(fill=tk.X, pady=(0, 8))

        # Source picker
        ttk.Label(folder_frame, text="Source:").grid(row=0, column=0, sticky=tk.W, padx=4, pady=4)
        ttk.Entry(folder_frame, textvariable=self.source_dir, width=60).grid(row=0, column=1, sticky=tk.EW, padx=4, pady=4)
        ttk.Button(folder_frame, text="Browse...", command=self._browse_source).grid(row=0, column=2, padx=4, pady=4)

        # Destination picker
        ttk.Label(folder_frame, text="Destination:").grid(row=1, column=0, sticky=tk.W, padx=4, pady=4)
        ttk.Entry(folder_frame, textvariable=self.dest_dir, width=60).grid(row=1, column=1, sticky=tk.EW, padx=4, pady=4)
        ttk.Button(folder_frame, text="Browse...", command=self._browse_dest).grid(row=1, column=2, padx=4, pady=4)

        folder_frame.columnconfigure(1, weight=1)

        # Controls & Action Buttons Frame
        action_frame = ttk.Frame(main_frame)
        action_frame.pack(fill=tk.X, pady=(0, 8))

        self.preview_btn = ttk.Button(action_frame, text="Preview", command=self._on_preview_click)
        self.preview_btn.pack(side=tk.LEFT, padx=(0, 6))

        self.start_btn = ttk.Button(action_frame, text="Start", command=self._on_start_click, state=tk.DISABLED)
        self.start_btn.pack(side=tk.LEFT, padx=6)

        self.undo_btn = ttk.Button(action_frame, text="Undo", command=self._on_undo_click, state=tk.DISABLED)
        self.undo_btn.pack(side=tk.LEFT, padx=6)

        self.progress_bar = ttk.Progressbar(action_frame, mode="determinate")
        self.progress_bar.pack(side=tk.RIGHT, fill=tk.X, expand=True, padx=(12, 0))

        # Count line label
        count_label = ttk.Label(main_frame, textvariable=self.count_var, font=("Segoe UI", 9, "bold"))
        count_label.pack(anchor=tk.W, pady=(4, 4))

        # Preview Treeview Table
        table_frame = ttk.Frame(main_frame)
        table_frame.pack(fill=tk.BOTH, expand=True, pady=(0, 8))

        columns = ("source", "dest", "matched_by", "size")
        self.tree = ttk.Treeview(table_frame, columns=columns, show="headings", selectmode="browse")
        self.tree.heading("source", text="Source")
        self.tree.heading("dest", text="Destination")
        self.tree.heading("matched_by", text="Matched by")
        self.tree.heading("size", text="Size")

        self.tree.column("source", width=280)
        self.tree.column("dest", width=340)
        self.tree.column("matched_by", width=180)
        self.tree.column("size", width=90, anchor=tk.E)

        y_scroll = ttk.Scrollbar(table_frame, orient=tk.VERTICAL, command=self.tree.yview)
        x_scroll = ttk.Scrollbar(table_frame, orient=tk.HORIZONTAL, command=self.tree.xview)
        self.tree.configure(yscrollcommand=y_scroll.set, xscrollcommand=x_scroll.set)

        self.tree.grid(row=0, column=0, sticky=tk.NSEW)
        y_scroll.grid(row=0, column=1, sticky=tk.NS)
        x_scroll.grid(row=1, column=0, sticky=tk.EW)

        table_frame.rowconfigure(0, weight=1)
        table_frame.columnconfigure(0, weight=1)

        # Status and Footer
        bottom_frame = ttk.Frame(main_frame)
        bottom_frame.pack(fill=tk.X)

        self.status_label = ttk.Label(bottom_frame, textvariable=self.status_var, relief=tk.SUNKEN, padding=(4, 2))
        self.status_label.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(0, 8))

        footer_label = ttk.Label(
            bottom_frame,
            text="Files are moved, not copied. Nothing is deleted.",
            font=("Segoe UI", 9, "italic"),
        )
        footer_label.pack(side=tk.RIGHT)

    def _browse_source(self) -> None:
        folder = filedialog.askdirectory(title="Select Source Folder")
        if folder:
            self.source_dir.set(folder)

    def _browse_dest(self) -> None:
        folder = filedialog.askdirectory(title="Select Destination Folder")
        if folder:
            self.dest_dir.set(folder)

    def update_undo_button_state(self) -> None:
        latest = find_latest_active_run_log()
        if latest is not None and not self.is_running:
            self.undo_btn.config(state=tk.NORMAL)
        else:
            self.undo_btn.config(state=tk.DISABLED)

    def _on_preview_click(self) -> None:
        src = self.source_dir.get().strip()
        dst = self.dest_dir.get().strip()

        if not src or not dst:
            messagebox.showwarning("Missing Folders", "Please select both source and destination folders.")
            return

        src_path = Path(src)
        dst_path = Path(dst)

        self.preview_btn.config(state=tk.DISABLED)
        self.start_btn.config(state=tk.DISABLED)
        self.status_var.set("Scanning source folder and generating preview...")

        def worker() -> None:
            try:
                plan = build_plan(src_path, dst_path)
                self.root.after(0, self._preview_success, plan)
            except Exception as e:
                self.root.after(0, self._preview_error, str(e))

        threading.Thread(target=worker, daemon=True).start()

    def _preview_success(self, plan: list[PlannedMove]) -> None:
        self.current_plan = plan
        self.tree.delete(*self.tree.get_children())

        ready_count = sum(1 for m in plan if m.status == "ready")
        skipped_count = sum(1 for m in plan if m.status == "skipped")
        refused_count = sum(1 for m in plan if m.status == "refused")

        for m in plan:
            target_display = str(m.target) if m.status != "skipped" else "-"
            self.tree.insert(
                "",
                tk.END,
                values=(
                    m.source.name,
                    target_display,
                    m.matched_by,
                    format_size(m.size),
                ),
            )

        self.count_var.set(f"{ready_count} files ready, {skipped_count} skipped, {refused_count} refused")
        self.status_var.set(f"Preview complete: {ready_count} files ready to move.")
        self.preview_btn.config(state=tk.NORMAL)

        if ready_count > 0:
            self.start_btn.config(state=tk.NORMAL)
        else:
            self.start_btn.config(state=tk.DISABLED)

    def _preview_error(self, err_msg: str) -> None:
        self.preview_btn.config(state=tk.NORMAL)
        self.start_btn.config(state=tk.DISABLED)
        self.status_var.set("Preview error")
        messagebox.showerror("Error Building Plan", err_msg)

    def _on_start_click(self) -> None:
        if not self.current_plan:
            return

        ready_moves = [m for m in self.current_plan if m.status == "ready"]
        if not ready_moves:
            messagebox.showinfo("No Files", "There are no files ready to move.")
            return

        confirm = messagebox.askyesno(
            "Confirm Move",
            f"Move {len(ready_moves)} files?\n\nFiles will be moved to destination folders. Nothing is deleted.",
        )
        if not confirm:
            return

        self.is_running = True
        self.preview_btn.config(state=tk.DISABLED)
        self.start_btn.config(state=tk.DISABLED)
        self.undo_btn.config(state=tk.DISABLED)

        self.progress_bar["maximum"] = len(ready_moves)
        self.progress_bar["value"] = 0
        self.status_var.set("Moving files...")

        runs_dir = get_runs_dir()
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        run_folder = runs_dir / f"run_{timestamp}"
        log_path = run_folder / "run.log"

        def worker() -> None:
            summary = run_plan(self.current_plan, log_path)
            self.root.after(0, self._move_finished, summary, log_path)

        threading.Thread(target=worker, daemon=True).start()

    def _move_finished(self, summary: dict, log_path: Path) -> None:
        self.is_running = False
        self.preview_btn.config(state=tk.NORMAL)
        self.progress_bar["value"] = summary.get("moved", 0)

        if summary.get("stopped"):
            self.status_var.set(f"Stopped: {summary.get('reason')}")
            messagebox.showerror("Run Stopped", summary.get("reason"))
        else:
            self.status_var.set(f"Run completed: {summary.get('moved')} moved, {summary.get('skipped')} skipped.")
            messagebox.showinfo("Complete", f"Successfully moved {summary.get('moved')} files.")

        self.current_plan = []
        self.start_btn.config(state=tk.DISABLED)
        self.update_undo_button_state()

    def _on_undo_click(self) -> None:
        latest_log = find_latest_active_run_log()
        if not latest_log:
            messagebox.showinfo("Undo", "No previous run available to undo.")
            return

        confirm = messagebox.askyesno(
            "Confirm Undo",
            f"Reverse the last run from log:\n{latest_log.name}?\n\nFiles will be returned to original locations.",
        )
        if not confirm:
            return

        self.is_running = True
        self.preview_btn.config(state=tk.DISABLED)
        self.start_btn.config(state=tk.DISABLED)
        self.undo_btn.config(state=tk.DISABLED)
        self.status_var.set("Reversing previous run...")

        def worker() -> None:
            try:
                summary = undo_run(latest_log)
                self.root.after(0, self._undo_finished, summary)
            except Exception as e:
                self.root.after(0, self._undo_error, str(e))

        threading.Thread(target=worker, daemon=True).start()

    def _undo_finished(self, summary: dict) -> None:
        self.is_running = False
        self.preview_btn.config(state=tk.NORMAL)
        self.status_var.set(f"Undo completed: {summary.get('restored')} files restored.")
        self.update_undo_button_state()
        messagebox.showinfo("Undo Completed", f"Successfully restored {summary.get('restored')} files.")

    def _undo_error(self, err_msg: str) -> None:
        self.is_running = False
        self.preview_btn.config(state=tk.NORMAL)
        self.status_var.set("Undo failed")
        self.update_undo_button_state()
        messagebox.showerror("Undo Error", err_msg)


def main() -> None:
    root = tk.Tk()
    NexoraApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
