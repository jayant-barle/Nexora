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
from nexora import theme


def format_size(size_bytes: int) -> str:
    """Format file size as KB, MB or GB with one decimal place."""
    kb = size_bytes / 1024.0
    if kb < 1024.0:
        return f"{kb:.1f} KB"
    mb = kb / 1024.0
    if mb < 1024.0:
        return f"{mb:.1f} MB"
    gb = mb / 1024.0
    return f"{gb:.1f} GB"


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
        self.root.geometry("980x660")
        self.root.minsize(800, 500)
        self.root.configure(bg=theme.COLOR_BG)

        self.source_dir = tk.StringVar()
        self.dest_dir = tk.StringVar()
        self.count_var = tk.StringVar(value="Select folders and click Preview to begin.")
        self.status_var = tk.StringVar(value="Ready")

        self.ready_count_var = tk.StringVar(value="0")
        self.skipped_count_var = tk.StringVar(value="0")
        self.refused_count_var = tk.StringVar(value="0")

        self.current_plan: list[PlannedMove] = []
        self.is_running = False

        self._init_theme()
        self._build_ui()
        self.update_undo_button_state()

    def _init_theme(self) -> None:
        """Initialize ttk theme once at startup."""
        self.style = ttk.Style(self.root)
        available = self.style.theme_names()
        if "vista" in available:
            try:
                self.style.theme_use("vista")
            except Exception:
                pass
        elif "clam" in available:
            try:
                self.style.theme_use("clam")
            except Exception:
                pass

        # Configure generic styles
        try:
            self.style.configure(".", font=theme.FONT_BODY)
            self.style.configure("Treeview.Heading", font=theme.FONT_BODY_BOLD)
            self.style.configure("Treeview", font=theme.FONT_BODY, rowheight=24)
            self.style.configure("TButton", padding=(12, 6))
        except Exception:
            pass

    def _build_ui(self) -> None:
        main_frame = tk.Frame(self.root, bg=theme.COLOR_BG, padx=16, pady=14)
        main_frame.pack(fill=tk.BOTH, expand=True)

        # 1. Top Header
        header_frame = tk.Frame(main_frame, bg=theme.COLOR_BG)
        header_frame.pack(fill=tk.X, pady=(0, 10))

        title_label = tk.Label(
            header_frame,
            text="Nexora",
            font=theme.FONT_TITLE,
            fg=theme.COLOR_TEXT,
            bg=theme.COLOR_BG,
        )
        title_label.pack(anchor=tk.W)

        subtitle_label = tk.Label(
            header_frame,
            text="Sort images and videos into folders. Nothing is deleted.",
            font=theme.FONT_BODY,
            fg=theme.COLOR_MUTED,
            bg=theme.COLOR_BG,
        )
        subtitle_label.pack(anchor=tk.W, pady=(2, 0))

        # 2. Folders Card
        folder_card = tk.Frame(
            main_frame,
            bg=theme.COLOR_CARD_BG,
            highlightbackground=theme.COLOR_CARD_BORDER,
            highlightthickness=1,
            padx=14,
            pady=12,
        )
        folder_card.pack(fill=tk.X, pady=(0, 10))

        card_title = tk.Label(
            folder_card,
            text="Folders",
            font=theme.FONT_SECTION,
            fg=theme.COLOR_TEXT,
            bg=theme.COLOR_CARD_BG,
        )
        card_title.grid(row=0, column=0, columnspan=3, sticky=tk.W, pady=(0, 8))

        # Source picker row
        tk.Label(
            folder_card,
            text="Source:",
            font=theme.FONT_BODY,
            fg=theme.COLOR_TEXT,
            bg=theme.COLOR_CARD_BG,
        ).grid(row=1, column=0, sticky=tk.W, padx=(0, 10), pady=4)

        source_entry = ttk.Entry(folder_card, textvariable=self.source_dir)
        source_entry.grid(row=1, column=1, sticky=tk.EW, padx=(0, 10), pady=4)

        browse_src_btn = tk.Button(
            folder_card,
            text="Browse...",
            command=self._browse_source,
            font=theme.FONT_BODY,
            bg=theme.COLOR_SECONDARY_BG,
            fg=theme.COLOR_SECONDARY_TEXT,
            activebackground=theme.COLOR_SECONDARY_HOVER,
            relief=tk.SOLID,
            bd=1,
            padx=12,
            pady=6,
            cursor="hand2",
        )
        browse_src_btn.grid(row=1, column=2, pady=4)

        # Destination picker row
        tk.Label(
            folder_card,
            text="Destination:",
            font=theme.FONT_BODY,
            fg=theme.COLOR_TEXT,
            bg=theme.COLOR_CARD_BG,
        ).grid(row=2, column=0, sticky=tk.W, padx=(0, 10), pady=4)

        dest_entry = ttk.Entry(folder_card, textvariable=self.dest_dir)
        dest_entry.grid(row=2, column=1, sticky=tk.EW, padx=(0, 10), pady=4)

        browse_dst_btn = tk.Button(
            folder_card,
            text="Browse...",
            command=self._browse_dest,
            font=theme.FONT_BODY,
            bg=theme.COLOR_SECONDARY_BG,
            fg=theme.COLOR_SECONDARY_TEXT,
            activebackground=theme.COLOR_SECONDARY_HOVER,
            relief=tk.SOLID,
            bd=1,
            padx=12,
            pady=6,
            cursor="hand2",
        )
        browse_dst_btn.grid(row=2, column=2, pady=4)

        folder_card.columnconfigure(1, weight=1)

        # 3. Action Buttons & Progress Bar Row
        self.action_frame = tk.Frame(main_frame, bg=theme.COLOR_BG)
        self.action_frame.pack(fill=tk.X, pady=(0, 10))

        self.preview_btn = tk.Button(
            self.action_frame,
            text="Preview",
            command=self._on_preview_click,
            font=theme.FONT_BODY_BOLD,
            bg=theme.COLOR_SECONDARY_BG,
            fg=theme.COLOR_SECONDARY_TEXT,
            activebackground=theme.COLOR_SECONDARY_HOVER,
            relief=tk.SOLID,
            bd=1,
            padx=14,
            pady=6,
            cursor="hand2",
        )
        self.preview_btn.pack(side=tk.LEFT, padx=(0, 8))

        self.start_btn = tk.Button(
            self.action_frame,
            text="Start",
            command=self._on_start_click,
            font=theme.FONT_BODY_BOLD,
            bg=theme.COLOR_PRIMARY_DISABLED,
            fg=theme.COLOR_PRIMARY_TEXT,
            activebackground=theme.COLOR_PRIMARY_HOVER,
            activeforeground=theme.COLOR_PRIMARY_TEXT,
            relief=tk.FLAT,
            bd=0,
            padx=16,
            pady=6,
            state=tk.DISABLED,
        )
        self.start_btn.pack(side=tk.LEFT, padx=(0, 8))

        self.undo_btn = tk.Button(
            self.action_frame,
            text="Undo",
            command=self._on_undo_click,
            font=theme.FONT_BODY,
            bg="#F3F4F6",
            fg=theme.COLOR_SECONDARY_DISABLED_TEXT,
            activebackground=theme.COLOR_SECONDARY_HOVER,
            relief=tk.SOLID,
            bd=1,
            padx=14,
            pady=6,
            state=tk.DISABLED,
        )
        self.undo_btn.pack(side=tk.LEFT, padx=(0, 8))

        self.progress_bar = ttk.Progressbar(self.action_frame, mode="determinate")
        # Hidden by default when idle; packed dynamically during start/undo

        # 4. Summary KPI Cards
        summary_frame = tk.Frame(main_frame, bg=theme.COLOR_BG)
        summary_frame.pack(fill=tk.X, pady=(0, 10))

        # Ready Card
        ready_card = tk.Frame(
            summary_frame,
            bg=theme.COLOR_CARD_BG,
            highlightbackground=theme.COLOR_CARD_BORDER,
            highlightthickness=1,
            padx=12,
            pady=8,
        )
        ready_card.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=(0, 6))

        tk.Label(
            ready_card,
            text="Ready",
            font=theme.FONT_KPI_LABEL,
            fg=theme.COLOR_MUTED,
            bg=theme.COLOR_CARD_BG,
        ).pack(anchor=tk.CENTER)

        tk.Label(
            ready_card,
            textvariable=self.ready_count_var,
            font=theme.FONT_KPI_NUM,
            fg=theme.COLOR_GOOD,
            bg=theme.COLOR_CARD_BG,
        ).pack(anchor=tk.CENTER)

        # Skipped Card
        skipped_card = tk.Frame(
            summary_frame,
            bg=theme.COLOR_CARD_BG,
            highlightbackground=theme.COLOR_CARD_BORDER,
            highlightthickness=1,
            padx=12,
            pady=8,
        )
        skipped_card.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=3)

        tk.Label(
            skipped_card,
            text="Skipped",
            font=theme.FONT_KPI_LABEL,
            fg=theme.COLOR_MUTED,
            bg=theme.COLOR_CARD_BG,
        ).pack(anchor=tk.CENTER)

        tk.Label(
            skipped_card,
            textvariable=self.skipped_count_var,
            font=theme.FONT_KPI_NUM,
            fg=theme.COLOR_SKIPPED,
            bg=theme.COLOR_CARD_BG,
        ).pack(anchor=tk.CENTER)

        # Refused Card
        refused_card = tk.Frame(
            summary_frame,
            bg=theme.COLOR_CARD_BG,
            highlightbackground=theme.COLOR_CARD_BORDER,
            highlightthickness=1,
            padx=12,
            pady=8,
        )
        refused_card.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=(6, 0))

        tk.Label(
            refused_card,
            text="Refused",
            font=theme.FONT_KPI_LABEL,
            fg=theme.COLOR_MUTED,
            bg=theme.COLOR_CARD_BG,
        ).pack(anchor=tk.CENTER)

        tk.Label(
            refused_card,
            textvariable=self.refused_count_var,
            font=theme.FONT_KPI_NUM,
            fg=theme.COLOR_REFUSED,
            bg=theme.COLOR_CARD_BG,
        ).pack(anchor=tk.CENTER)

        # 5. Preview Table in Card
        table_card = tk.Frame(
            main_frame,
            bg=theme.COLOR_CARD_BG,
            highlightbackground=theme.COLOR_CARD_BORDER,
            highlightthickness=1,
            padx=1,
            pady=1,
        )
        table_card.pack(fill=tk.BOTH, expand=True, pady=(0, 10))

        columns = ("source", "dest", "matched_by", "size")
        self.tree = ttk.Treeview(table_card, columns=columns, show="headings", selectmode="browse")
        self.tree.heading("source", text="Source")
        self.tree.heading("dest", text="Destination")
        self.tree.heading("matched_by", text="Matched by")
        self.tree.heading("size", text="Size")

        self.tree.column("source", width=320)
        self.tree.column("dest", width=380)
        self.tree.column("matched_by", width=140)
        self.tree.column("size", width=90, anchor=tk.E)

        # Alternating row tag colors
        self.tree.tag_configure("even", background=theme.COLOR_ROW_EVEN)
        self.tree.tag_configure("odd", background=theme.COLOR_ROW_ODD)

        y_scroll = ttk.Scrollbar(table_card, orient=tk.VERTICAL, command=self.tree.yview)
        x_scroll = ttk.Scrollbar(table_card, orient=tk.HORIZONTAL, command=self.tree.xview)
        self.tree.configure(yscrollcommand=y_scroll.set, xscrollcommand=x_scroll.set)

        self.tree.grid(row=0, column=0, sticky=tk.NSEW)
        y_scroll.grid(row=0, column=1, sticky=tk.NS)
        x_scroll.grid(row=1, column=0, sticky=tk.EW)

        table_card.rowconfigure(0, weight=1)
        table_card.columnconfigure(0, weight=1)

        def _on_table_resize(event: tk.Event) -> None:
            width = event.width - 24
            if width > 300:
                self.tree.column("source", width=int(width * 0.35))
                self.tree.column("dest", width=int(width * 0.40))
                self.tree.column("matched_by", width=int(width * 0.15))
                self.tree.column("size", width=int(width * 0.10), anchor=tk.E)

        table_card.bind("<Configure>", _on_table_resize)

        # 6. Status and Footer
        bottom_frame = tk.Frame(main_frame, bg=theme.COLOR_BG)
        bottom_frame.pack(fill=tk.X)

        self.status_label = tk.Label(
            bottom_frame,
            textvariable=self.status_var,
            font=theme.FONT_BODY,
            fg=theme.COLOR_TEXT,
            bg=theme.COLOR_BG,
            anchor=tk.W,
        )
        self.status_label.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(0, 10))

        self.footer_label = tk.Label(
            bottom_frame,
            text="Files are moved, not copied. Nothing is deleted.",
            font=theme.FONT_FOOTER,
            fg=theme.COLOR_MUTED,
            bg=theme.COLOR_BG,
        )
        self.footer_label.pack(side=tk.RIGHT)

    def _browse_source(self) -> None:
        folder = filedialog.askdirectory(title="Select Source Folder")
        if folder:
            self.source_dir.set(os.path.normpath(folder))

    def _browse_dest(self) -> None:
        folder = filedialog.askdirectory(title="Select Destination Folder")
        if folder:
            self.dest_dir.set(os.path.normpath(folder))

    def update_undo_button_state(self) -> None:
        latest = find_latest_active_run_log()
        if latest is not None and not self.is_running:
            self.undo_btn.config(
                state=tk.NORMAL,
                bg=theme.COLOR_SECONDARY_BG,
                fg=theme.COLOR_SECONDARY_TEXT,
                cursor="hand2",
            )
        else:
            self.undo_btn.config(
                state=tk.DISABLED,
                bg="#F3F4F6",
                fg=theme.COLOR_SECONDARY_DISABLED_TEXT,
                cursor="arrow",
            )

    def _set_start_button_state(self, enabled: bool) -> None:
        if enabled:
            self.start_btn.config(
                state=tk.NORMAL,
                bg=theme.COLOR_PRIMARY,
                fg=theme.COLOR_PRIMARY_TEXT,
                cursor="hand2",
            )
        else:
            self.start_btn.config(
                state=tk.DISABLED,
                bg=theme.COLOR_PRIMARY_DISABLED,
                fg=theme.COLOR_PRIMARY_TEXT,
                cursor="arrow",
            )

    def _set_preview_button_state(self, enabled: bool) -> None:
        if enabled:
            self.preview_btn.config(
                state=tk.NORMAL,
                bg=theme.COLOR_SECONDARY_BG,
                fg=theme.COLOR_SECONDARY_TEXT,
                cursor="hand2",
            )
        else:
            self.preview_btn.config(
                state=tk.DISABLED,
                bg="#F3F4F6",
                fg=theme.COLOR_SECONDARY_DISABLED_TEXT,
                cursor="arrow",
            )

    def _on_preview_click(self) -> None:
        src = self.source_dir.get().strip()
        dst = self.dest_dir.get().strip()

        if not src or not dst:
            messagebox.showwarning("Missing Folders", "Please select both source and destination folders.")
            return

        src_path = Path(src)
        dst_path = Path(dst)

        self._set_preview_button_state(False)
        self._set_start_button_state(False)
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

        for idx, m in enumerate(plan):
            target_display = os.path.normpath(str(m.target)) if m.status != "skipped" else "-"
            tag = "odd" if idx % 2 == 1 else "even"
            self.tree.insert(
                "",
                tk.END,
                values=(
                    os.path.normpath(m.source.name),
                    target_display,
                    m.matched_by,
                    format_size(m.size),
                ),
                tags=(tag,),
            )

        self.ready_count_var.set(str(ready_count))
        self.skipped_count_var.set(str(skipped_count))
        self.refused_count_var.set(str(refused_count))

        self.count_var.set(f"{ready_count} files ready, {skipped_count} skipped, {refused_count} refused")
        self.status_var.set(f"Preview complete: {ready_count} files ready to move.")
        self._set_preview_button_state(True)
        self._set_start_button_state(ready_count > 0)

    def _preview_error(self, err_msg: str) -> None:
        self._set_preview_button_state(True)
        self._set_start_button_state(False)
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
        self._set_preview_button_state(False)
        self._set_start_button_state(False)
        self.undo_btn.config(state=tk.DISABLED, bg="#F3F4F6", fg=theme.COLOR_SECONDARY_DISABLED_TEXT, cursor="arrow")

        # Show progress bar during execution
        self.progress_bar.pack(side=tk.RIGHT, fill=tk.X, expand=True, padx=(16, 0))
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
        # Hide progress bar when idle
        self.progress_bar.pack_forget()
        self._set_preview_button_state(True)

        if summary.get("stopped"):
            self.status_var.set(f"Stopped: {summary.get('reason')}")
            messagebox.showerror("Run Stopped", summary.get("reason"))
        else:
            self.status_var.set(f"Run completed: {summary.get('moved')} moved, {summary.get('skipped')} skipped.")
            messagebox.showinfo("Complete", f"Successfully moved {summary.get('moved')} files.")

        self.current_plan = []
        self._set_start_button_state(False)
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
        self._set_preview_button_state(False)
        self._set_start_button_state(False)
        self.undo_btn.config(state=tk.DISABLED, bg="#F3F4F6", fg=theme.COLOR_SECONDARY_DISABLED_TEXT, cursor="arrow")

        # Show progress bar during undo
        self.progress_bar.pack(side=tk.RIGHT, fill=tk.X, expand=True, padx=(16, 0))
        self.progress_bar["mode"] = "indeterminate"
        self.progress_bar.start(10)
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
        self.progress_bar.stop()
        self.progress_bar["mode"] = "determinate"
        self.progress_bar.pack_forget()
        self._set_preview_button_state(True)
        self.status_var.set(f"Undo completed: {summary.get('restored')} files restored.")
        self.update_undo_button_state()
        messagebox.showinfo("Undo Completed", f"Successfully restored {summary.get('restored')} files.")

    def _undo_error(self, err_msg: str) -> None:
        self.is_running = False
        self.progress_bar.stop()
        self.progress_bar["mode"] = "determinate"
        self.progress_bar.pack_forget()
        self._set_preview_button_state(True)
        self.status_var.set("Undo failed")
        self.update_undo_button_state()
        messagebox.showerror("Undo Error", err_msg)


def main() -> None:
    root = tk.Tk()
    NexoraApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
