"""Tkinter GUI for Nexora Stage 4: People screen, scanning, and approval."""

from __future__ import annotations

import os
import sys
import multiprocessing
import threading
from datetime import datetime
from pathlib import Path
from typing import Callable, Any
import tkinter as tk
from tkinter import filedialog, messagebox, ttk
from PIL import Image, ImageTk

from nexora.plan import PlannedMove, build_plan
from nexora.mover import run_plan
from nexora.undo import undo_run
from nexora import theme
from nexora.faces.groups import FaceClusterManager
from nexora.faces.people import PeopleManager, validate_person_name


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
    """Get the runs directory path next to app.py or executable."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent / "runs"
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
    """Nexora main desktop application window with tabs for Sorting and People."""

    def __init__(self, root: tk.Tk) -> None:
        if multiprocessing.current_process().name != "MainProcess":
            raise RuntimeError("Worker process must never create a UI window.")
        self.root = root
        self.root.title("Nexora")
        self.root.geometry("1020x720")
        self.root.minsize(840, 560)
        self.root.configure(bg=theme.COLOR_BG)

        self.source_dir = tk.StringVar()
        self.dest_dir = tk.StringVar()
        self.count_var = tk.StringVar(value="Select folders and click Preview to begin.")
        self.status_var = tk.StringVar(value="Ready")

        self.ready_count_var = tk.StringVar(value="0")
        self.skipped_count_var = tk.StringVar(value="0")
        self.refused_count_var = tk.StringVar(value="0")

        self.cluster_manager = FaceClusterManager()
        self.people_manager = PeopleManager(self.cluster_manager)
        if self.cluster_manager.corrupt_backup_path:
            self.status_var.set(
                f"Corrupt faces.json moved to {self.cluster_manager.corrupt_backup_path.name}; starting clean."
            )
        elif self.cluster_manager.json_path.exists():
            visible = self.people_manager.get_visible_groups()
            m_scanned = len(self.cluster_manager.cache)
            self.status_var.set(f"Found {len(visible)} people from {m_scanned} scanned images")
        self.current_plan: list[PlannedMove] = []
        self.is_running = False
        self.scan_stop_event: threading.Event | None = None

        self.crop_photo_cache: list[ImageTk.PhotoImage] = []
        self.people_search_var = tk.StringVar(value="")
        self.people_sort_var = tk.StringVar(value="Largest first")

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

        try:
            self.style.configure(".", font=theme.FONT_BODY)
            self.style.configure("Treeview.Heading", font=theme.FONT_BODY_BOLD)
            self.style.configure("Treeview", font=theme.FONT_BODY, rowheight=24)
            self.style.configure("TButton", padding=(12, 6))
            self.style.configure("TNotebook.Tab", font=theme.FONT_BODY_BOLD, padding=(16, 6))
        except Exception:
            pass

    def _build_ui(self) -> None:
        main_frame = tk.Frame(self.root, bg=theme.COLOR_BG, padx=16, pady=12)
        main_frame.pack(fill=tk.BOTH, expand=True)

        # 1. Top Header
        header_frame = tk.Frame(main_frame, bg=theme.COLOR_BG)
        header_frame.pack(fill=tk.X, pady=(0, 8))

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

        # 2. Notebook with Tabs: Sort & Move, People
        self.notebook = ttk.Notebook(main_frame)
        self.notebook.pack(fill=tk.BOTH, expand=True, pady=(0, 8))

        self.tab_sort = tk.Frame(self.notebook, bg=theme.COLOR_BG, padx=8, pady=8)
        self.tab_people = tk.Frame(self.notebook, bg=theme.COLOR_BG, padx=8, pady=8)

        self.notebook.add(self.tab_sort, text="  Sort & Move  ")
        self.notebook.add(self.tab_people, text="  People  ")
        self.notebook.bind("<<NotebookTabChanged>>", self._on_tab_changed)

        self._build_sort_tab()
        self._build_people_tab()

        # 3. Bottom Status and Footer
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

        # Footer text stays exactly: "Files are moved, not copied. Nothing is deleted."
        self.footer_label = tk.Label(
            bottom_frame,
            text="Files are moved, not copied. Nothing is deleted.",
            font=theme.FONT_FOOTER,
            fg=theme.COLOR_MUTED,
            bg=theme.COLOR_BG,
        )
        self.footer_label.pack(side=tk.RIGHT)

    def _build_sort_tab(self) -> None:
        """Build Sort & Move tab with folders card, action buttons, summary cards, and table."""
        # Folders Card
        folder_card = tk.Frame(
            self.tab_sort,
            bg=theme.COLOR_CARD_BG,
            highlightbackground=theme.COLOR_CARD_BORDER,
            highlightthickness=1,
            padx=14,
            pady=10,
        )
        folder_card.pack(fill=tk.X, pady=(0, 8))

        card_title = tk.Label(
            folder_card,
            text="Folders",
            font=theme.FONT_SECTION,
            fg=theme.COLOR_TEXT,
            bg=theme.COLOR_CARD_BG,
        )
        card_title.grid(row=0, column=0, columnspan=3, sticky=tk.W, pady=(0, 6))

        # Source picker
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
            pady=4,
            cursor="hand2",
        )
        browse_src_btn.grid(row=1, column=2, pady=4)

        # Destination picker
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
            pady=4,
            cursor="hand2",
        )
        browse_dst_btn.grid(row=2, column=2, pady=4)

        folder_card.columnconfigure(1, weight=1)

        # Action Buttons Row: "Scan people", "Preview", "Approve", "Undo"
        self.action_frame = tk.Frame(self.tab_sort, bg=theme.COLOR_BG)
        self.action_frame.pack(fill=tk.X, pady=(0, 8))

        self.scan_people_btn = tk.Button(
            self.action_frame,
            text="Scan people",
            command=self._on_scan_people_click,
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
        self.scan_people_btn.pack(side=tk.LEFT, padx=(0, 8))

        self.stop_scan_btn = tk.Button(
            self.action_frame,
            text="Stop",
            command=self._on_stop_scan_click,
            font=theme.FONT_BODY,
            bg="#FEE2E2",
            fg=theme.COLOR_REFUSED,
            relief=tk.SOLID,
            bd=1,
            padx=10,
            pady=6,
            cursor="hand2",
        )
        # Not packed initially; shown only while scanning

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

        # Start button (enabled only after preview; disabled while running)
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
        self.approve_btn = self.start_btn

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
        # Packed dynamically during actions

        # Summary KPI Cards
        summary_frame = tk.Frame(self.tab_sort, bg=theme.COLOR_BG)
        summary_frame.pack(fill=tk.X, pady=(0, 8))

        ready_card = tk.Frame(
            summary_frame,
            bg=theme.COLOR_CARD_BG,
            highlightbackground=theme.COLOR_CARD_BORDER,
            highlightthickness=1,
            padx=12,
            pady=6,
        )
        ready_card.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=(0, 6))
        tk.Label(ready_card, text="Ready", font=theme.FONT_KPI_LABEL, fg=theme.COLOR_MUTED, bg=theme.COLOR_CARD_BG).pack(anchor=tk.CENTER)
        tk.Label(ready_card, textvariable=self.ready_count_var, font=theme.FONT_KPI_NUM, fg=theme.COLOR_GOOD, bg=theme.COLOR_CARD_BG).pack(anchor=tk.CENTER)

        skipped_card = tk.Frame(
            summary_frame,
            bg=theme.COLOR_CARD_BG,
            highlightbackground=theme.COLOR_CARD_BORDER,
            highlightthickness=1,
            padx=12,
            pady=6,
        )
        skipped_card.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=3)
        tk.Label(skipped_card, text="Skipped", font=theme.FONT_KPI_LABEL, fg=theme.COLOR_MUTED, bg=theme.COLOR_CARD_BG).pack(anchor=tk.CENTER)
        tk.Label(skipped_card, textvariable=self.skipped_count_var, font=theme.FONT_KPI_NUM, fg=theme.COLOR_SKIPPED, bg=theme.COLOR_CARD_BG).pack(anchor=tk.CENTER)

        refused_card = tk.Frame(
            summary_frame,
            bg=theme.COLOR_CARD_BG,
            highlightbackground=theme.COLOR_CARD_BORDER,
            highlightthickness=1,
            padx=12,
            pady=6,
        )
        refused_card.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=(6, 0))
        tk.Label(refused_card, text="Refused", font=theme.FONT_KPI_LABEL, fg=theme.COLOR_MUTED, bg=theme.COLOR_CARD_BG).pack(anchor=tk.CENTER)
        tk.Label(refused_card, textvariable=self.refused_count_var, font=theme.FONT_KPI_NUM, fg=theme.COLOR_REFUSED, bg=theme.COLOR_CARD_BG).pack(anchor=tk.CENTER)

        # Preview Table: columns Source, Destination, Matched by, Size
        table_card = tk.Frame(
            self.tab_sort,
            bg=theme.COLOR_CARD_BG,
            highlightbackground=theme.COLOR_CARD_BORDER,
            highlightthickness=1,
            padx=1,
            pady=1,
        )
        table_card.pack(fill=tk.BOTH, expand=True, pady=(0, 4))

        columns = ("source", "dest", "matched_by", "size")
        self.tree = ttk.Treeview(table_card, columns=columns, show="headings", selectmode="browse")
        self.tree.heading("source", text="Source")
        self.tree.heading("dest", text="Destination")
        self.tree.heading("matched_by", text="Matched by")
        self.tree.heading("size", text="Size")

        self.tree.column("source", width=300)
        self.tree.column("dest", width=360)
        self.tree.column("matched_by", width=160)
        self.tree.column("size", width=90, anchor=tk.E)

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

    def _build_people_tab(self) -> None:
        """Build People screen tab with group cards, crops, name box, save, split and merge."""
        top_bar = tk.Frame(self.tab_people, bg=theme.COLOR_BG)
        top_bar.pack(fill=tk.X, pady=(0, 6))

        tk.Label(
            top_bar,
            text="People and Groups",
            font=theme.FONT_SECTION,
            fg=theme.COLOR_TEXT,
            bg=theme.COLOR_BG,
        ).pack(side=tk.LEFT)

        refresh_btn = tk.Button(
            top_bar,
            text="Refresh",
            command=self.render_people_cards,
            font=theme.FONT_BODY,
            bg=theme.COLOR_SECONDARY_BG,
            fg=theme.COLOR_SECONDARY_TEXT,
            relief=tk.SOLID,
            bd=1,
            padx=10,
            pady=3,
            cursor="hand2",
        )
        refresh_btn.pack(side=tk.RIGHT)

        self.unreadable_btn = tk.Button(
            top_bar,
            text=f"Unreadable files ({len(self.cluster_manager.unreadable)})",
            command=self._show_unreadable_files_window,
            font=theme.FONT_BODY,
            bg=theme.COLOR_SECONDARY_BG,
            fg=theme.COLOR_SECONDARY_TEXT,
            relief=tk.SOLID,
            bd=1,
            padx=10,
            pady=3,
            cursor="hand2",
        )
        self.unreadable_btn.pack(side=tk.RIGHT, padx=(0, 8))

        # Controls / Filter Bar: Search box & Sort dropdown
        controls_bar = tk.Frame(self.tab_people, bg=theme.COLOR_BG)
        controls_bar.pack(fill=tk.X, pady=(0, 8))

        # Search
        tk.Label(
            controls_bar,
            text="Search:",
            font=theme.FONT_BODY,
            fg=theme.COLOR_TEXT,
            bg=theme.COLOR_BG,
        ).pack(side=tk.LEFT, padx=(0, 6))

        self.people_search_entry = ttk.Entry(
            controls_bar,
            textvariable=self.people_search_var,
            font=theme.FONT_BODY,
            width=22,
        )
        self.people_search_entry.pack(side=tk.LEFT, padx=(0, 16))
        self.people_search_var.trace_add("write", lambda *_: self.render_people_cards())

        # Sort
        tk.Label(
            controls_bar,
            text="Sort:",
            font=theme.FONT_BODY,
            fg=theme.COLOR_TEXT,
            bg=theme.COLOR_BG,
        ).pack(side=tk.LEFT, padx=(0, 6))

        self.people_sort_dropdown = ttk.Combobox(
            controls_bar,
            textvariable=self.people_sort_var,
            values=["Largest first", "Smallest first", "Name A-Z", "Needs review first"],
            font=theme.FONT_BODY,
            width=18,
            state="readonly",
        )
        self.people_sort_dropdown.pack(side=tk.LEFT)
        self.people_sort_dropdown.bind("<<ComboboxSelected>>", lambda e: self.render_people_cards())

        # Scrollable container for cards
        card_container = tk.Frame(
            self.tab_people,
            bg=theme.COLOR_CARD_BG,
            highlightbackground=theme.COLOR_CARD_BORDER,
            highlightthickness=1,
        )
        card_container.pack(fill=tk.BOTH, expand=True)

        self.people_canvas = tk.Canvas(card_container, bg=theme.COLOR_CARD_BG, highlightthickness=0)
        self.people_scrollbar = ttk.Scrollbar(card_container, orient=tk.VERTICAL, command=self.people_canvas.yview)
        self.people_scroll_frame = tk.Frame(self.people_canvas, bg=theme.COLOR_CARD_BG, padx=12, pady=12)

        self.people_scroll_frame.bind(
            "<Configure>",
            lambda e: self.people_canvas.configure(scrollregion=self.people_canvas.bbox("all")),
        )
        self.people_canvas_window = self.people_canvas.create_window((0, 0), window=self.people_scroll_frame, anchor="nw")
        self.people_canvas.configure(yscrollcommand=self.people_scrollbar.set)

        self.people_canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        self.people_scrollbar.pack(side=tk.RIGHT, fill=tk.Y)

        self.people_canvas.bind(
            "<Configure>",
            lambda e: self.people_canvas.itemconfig(self.people_canvas_window, width=e.width - 24),
        )

    def _on_tab_changed(self, event: Any) -> None:
        """Refresh people screen when switching to the People tab."""
        selected_idx = self.notebook.index("current")
        if selected_idx == 1:
            self.render_people_cards()

    def render_people_cards(self) -> None:
        """Render one card per face group with sample crops, naming, split, and merge."""
        self.cluster_manager.load()
        self.crop_photo_cache.clear()
        if hasattr(self, "unreadable_btn"):
            self.unreadable_btn.config(text=f"Unreadable files ({len(self.cluster_manager.unreadable)})")
        if self.cluster_manager.corrupt_backup_path:
            self.status_var.set(
                f"Corrupt faces.json moved to {self.cluster_manager.corrupt_backup_path.name}; starting clean."
            )

        for widget in self.people_scroll_frame.winfo_children():
            widget.destroy()

        # Suggested merges section above group cards
        suggestions_box = tk.Frame(
            self.people_scroll_frame,
            bg=theme.COLOR_CARD_BG,
            highlightbackground=theme.COLOR_CARD_BORDER,
            highlightthickness=1,
            padx=14,
            pady=12,
        )
        suggestions_box.pack(fill=tk.X, expand=True, pady=(0, 14))
        self.suggestions_frame = suggestions_box

        tk.Label(
            suggestions_box,
            text="Suggested Merges",
            font=theme.FONT_SECTION,
            fg=theme.COLOR_TEXT,
            bg=theme.COLOR_CARD_BG,
        ).pack(anchor=tk.W, pady=(0, 4))

        suggestions, total_suggestions = self.people_manager.get_merge_suggestions()
        if not suggestions:
            tk.Label(
                suggestions_box,
                text="No suggested merges.",
                font=theme.FONT_BODY,
                fg=theme.COLOR_MUTED,
                bg=theme.COLOR_CARD_BG,
            ).pack(anchor=tk.W, pady=(2, 2))
        else:
            if total_suggestions > len(suggestions):
                tk.Label(
                    suggestions_box,
                    text=f"Showing top {len(suggestions)} of {total_suggestions} suggestions (cap of 50 reached).",
                    font=theme.FONT_BODY,
                    fg="#D97706",
                    bg=theme.COLOR_CARD_BG,
                ).pack(anchor=tk.W, pady=(0, 6))

            for s in suggestions:
                s_card = tk.Frame(
                    suggestions_box,
                    bg=theme.COLOR_BG,
                    highlightbackground=theme.COLOR_CARD_BORDER,
                    highlightthickness=1,
                    padx=10,
                    pady=8,
                )
                s_card.pack(fill=tk.X, expand=True, pady=(4, 6))

                content_row = tk.Frame(s_card, bg=theme.COLOR_BG)
                content_row.pack(fill=tk.X, expand=True)

                # Group A
                grp_a_frame = tk.Frame(content_row, bg=theme.COLOR_BG)
                grp_a_frame.pack(side=tk.LEFT)

                crop_a_path = s["group_a_crop"]
                if crop_a_path and os.path.exists(crop_a_path):
                    try:
                        img_a = Image.open(crop_a_path).resize((56, 56))
                        tk_img_a = ImageTk.PhotoImage(img_a)
                        self.crop_photo_cache.append(tk_img_a)
                        tk.Label(grp_a_frame, image=tk_img_a, bg="#E5E7EB", width=56, height=56).pack(side=tk.LEFT, padx=(0, 8))
                    except Exception:
                        pass

                info_a = tk.Frame(grp_a_frame, bg=theme.COLOR_BG)
                info_a.pack(side=tk.LEFT)
                tk.Label(info_a, text=s["group_a_name"], font=theme.FONT_BODY_BOLD, fg=theme.COLOR_TEXT, bg=theme.COLOR_BG).pack(anchor=tk.W)
                tk.Label(info_a, text=f"{s['group_a_photos']} photos", font=theme.FONT_BODY, fg=theme.COLOR_MUTED, bg=theme.COLOR_BG).pack(anchor=tk.W)

                # Similarity in middle
                sim_frame = tk.Frame(content_row, bg=theme.COLOR_BG)
                sim_frame.pack(side=tk.LEFT, padx=16)
                tk.Label(
                    sim_frame,
                    text=f"↔ {s['similarity']:.2f} similarity",
                    font=theme.FONT_BODY_BOLD,
                    fg="#2563EB",
                    bg=theme.COLOR_BG,
                ).pack()

                # Group B
                grp_b_frame = tk.Frame(content_row, bg=theme.COLOR_BG)
                grp_b_frame.pack(side=tk.LEFT)

                crop_b_path = s["group_b_crop"]
                if crop_b_path and os.path.exists(crop_b_path):
                    try:
                        img_b = Image.open(crop_b_path).resize((56, 56))
                        tk_img_b = ImageTk.PhotoImage(img_b)
                        self.crop_photo_cache.append(tk_img_b)
                        tk.Label(grp_b_frame, image=tk_img_b, bg="#E5E7EB", width=56, height=56).pack(side=tk.LEFT, padx=(0, 8))
                    except Exception:
                        pass

                info_b = tk.Frame(grp_b_frame, bg=theme.COLOR_BG)
                info_b.pack(side=tk.LEFT)
                tk.Label(info_b, text=s["group_b_name"], font=theme.FONT_BODY_BOLD, fg=theme.COLOR_TEXT, bg=theme.COLOR_BG).pack(anchor=tk.W)
                tk.Label(info_b, text=f"{s['group_b_photos']} photos", font=theme.FONT_BODY, fg=theme.COLOR_MUTED, bg=theme.COLOR_BG).pack(anchor=tk.W)

                # Action buttons on right
                btns_frame = tk.Frame(content_row, bg=theme.COLOR_BG)
                btns_frame.pack(side=tk.RIGHT)

                gid_a = s["group_a_id"]
                gid_b = s["group_b_id"]

                def make_suggested_merge_cmd(ga_id=gid_a, gb_id=gid_b):
                    def merge_action():
                        g_a_obj = next((g for g in self.people_manager.groups if g["id"] == ga_id), {})
                        g_b_obj = next((g for g in self.people_manager.groups if g["id"] == gb_id), {})
                        if (g_b_obj.get("name") or g_b_obj.get("display_name")) and not (g_a_obj.get("name") or g_a_obj.get("display_name")):
                            target_id, source_id = gb_id, ga_id
                        else:
                            target_id, source_id = ga_id, gb_id
                        if self.people_manager.would_guard_refuse_merge(target_id, source_id):
                            n_faces = self.people_manager.get_group_size(source_id)
                            m_faces = self.people_manager.get_group_size(target_id)
                            confirmed = messagebox.askyesno(
                                "Confirm Merge",
                                f"This merges {n_faces} faces into a group of {m_faces} faces. Continue?",
                            )
                            if not confirmed:
                                return
                        merged_ok = self.people_manager.merge_groups(target_id, source_id, is_automatic=False)
                        if merged_ok:
                            messagebox.showinfo("Merged", f"Group merged into {target_id}.")
                        self.render_people_cards()
                    return merge_action

                def make_dismiss_cmd(ga_id=gid_a, gb_id=gid_b):
                    def dismiss_action():
                        self.people_manager.dismiss_merge(ga_id, gb_id)
                        self.render_people_cards()
                    return dismiss_action

                tk.Button(
                    btns_frame,
                    text="Merge",
                    command=make_suggested_merge_cmd(),
                    font=theme.FONT_BODY,
                    bg=theme.COLOR_PRIMARY,
                    fg=theme.COLOR_PRIMARY_TEXT,
                    relief=tk.FLAT,
                    padx=10,
                    pady=3,
                    cursor="hand2",
                ).pack(side=tk.LEFT, padx=(0, 6))

                tk.Button(
                    btns_frame,
                    text="Not the same person",
                    command=make_dismiss_cmd(),
                    font=theme.FONT_BODY,
                    bg=theme.COLOR_SECONDARY_BG,
                    fg=theme.COLOR_SECONDARY_TEXT,
                    relief=tk.SOLID,
                    bd=1,
                    padx=8,
                    pady=3,
                    cursor="hand2",
                ).pack(side=tk.LEFT)

        groups = self.people_manager.get_visible_groups()
        if not groups:
            tk.Label(
                self.people_scroll_frame,
                text="No face groups scanned yet. Run 'Scan people' on the Sort & Move tab.",
                font=theme.FONT_BODY,
                fg=theme.COLOR_MUTED,
                bg=theme.COLOR_CARD_BG,
            ).pack(pady=30)
            return

        unnamed_numbering = self.people_manager.get_unnamed_numbering()

        # Apply search filtering
        search_query = self.people_search_var.get() if hasattr(self, "people_search_var") else ""
        filtered_groups = self.people_manager.filter_groups(groups, search_query)

        # Apply sorting
        sort_by = self.people_sort_var.get() if hasattr(self, "people_sort_var") else "Largest first"
        display_groups = self.people_manager.sort_groups(filtered_groups, sort_by)

        if not display_groups:
            tk.Label(
                self.people_scroll_frame,
                text=f"No people match '{search_query.strip()}'.",
                font=theme.FONT_BODY,
                fg=theme.COLOR_MUTED,
                bg=theme.COLOR_CARD_BG,
            ).pack(pady=30)
            return

        # Render one card per group
        for group in display_groups:
            gid = group["id"]
            card = tk.Frame(
                self.people_scroll_frame,
                bg=theme.COLOR_BG,
                highlightbackground=theme.COLOR_CARD_BORDER,
                highlightthickness=1,
                padx=12,
                pady=10,
            )
            card.pack(fill=tk.X, expand=True, pady=(0, 10))

            # Header row: display name & size
            display_name = group.get("display_name") or group.get("name")
            if not display_name:
                display_name = unnamed_numbering.get(gid, "Unnamed person")

            size = self.people_manager.get_group_size(gid)

            header_frame = tk.Frame(card, bg=theme.COLOR_BG)
            header_frame.pack(fill=tk.X, pady=(0, 8))

            tk.Label(
                header_frame,
                text=display_name,
                font=theme.FONT_SECTION,
                fg=theme.COLOR_TEXT,
                bg=theme.COLOR_BG,
            ).pack(side=tk.LEFT)

            tk.Label(
                header_frame,
                text=f"({size} faces)",
                font=theme.FONT_BODY,
                fg=theme.COLOR_MUTED,
                bg=theme.COLOR_BG,
            ).pack(side=tk.LEFT, padx=(8, 0))

            if group.get("needs_review"):
                tk.Label(
                    header_frame,
                    text="large group: name it to use it",
                    font=theme.FONT_BODY,
                    fg="#DC2626",
                    bg=theme.COLOR_BG,
                ).pack(side=tk.LEFT, padx=(8, 0))

            # Status row: placement status & associated photos
            status_row = tk.Frame(card, bg=theme.COLOR_BG)
            status_row.pack(fill=tk.X, pady=(0, 4))

            folder_name = (group.get("name") or "").strip().lower()
            needs_review = group.get("needs_review", False)

            if needs_review and not folder_name:
                status_text = "Placement: Withheld (needs review - large group: name it to use it)"
                status_fg = "#DC2626"
            elif not folder_name:
                status_text = "Placement: Withheld (unnamed - name it to use it)"
                status_fg = "#D97706"
            else:
                status_text = f"Placement: Active -> folder '{folder_name}/'"
                status_fg = "#059669"

            tk.Label(
                status_row,
                text=status_text,
                font=theme.FONT_BODY_BOLD,
                fg=status_fg,
                bg=theme.COLOR_BG,
            ).pack(side=tk.LEFT)

            group_files = [Path(fk).name for fk, gids in self.people_manager.file_groups.items() if gid in gids]
            if group_files:
                sample_files = group_files[:3]
                extra = f" (+{len(group_files) - 3} more)" if len(group_files) > 3 else ""
                files_text = f"Photos ({len(group_files)}): {', '.join(sample_files)}{extra}"
                tk.Label(
                    status_row,
                    text=f"  |  {files_text}",
                    font=theme.FONT_BODY,
                    fg=theme.COLOR_MUTED,
                    bg=theme.COLOR_BG,
                ).pack(side=tk.LEFT)

            # Crops strip: up to 6 sample face crops
            crops_strip = tk.Frame(card, bg=theme.COLOR_BG)
            crops_strip.pack(fill=tk.X, pady=(0, 8))

            crop_paths = group.get("crop_paths", [])
            if not crop_paths and group.get("crop_path"):
                crop_paths = [group["crop_path"]]

            crops_to_show = crop_paths[:6]
            if crops_to_show:
                for c_path in crops_to_show:
                    if os.path.exists(c_path):
                        try:
                            pil_img = Image.open(c_path).resize((56, 56))
                            tk_img = ImageTk.PhotoImage(pil_img)
                            self.crop_photo_cache.append(tk_img)
                            lbl = tk.Label(crops_strip, image=tk_img, bg="#E5E7EB", width=56, height=56)
                            lbl.pack(side=tk.LEFT, padx=(0, 6))
                        except Exception:
                            pass
            else:
                tk.Label(
                    crops_strip,
                    text="[No preview crops]",
                    font=theme.FONT_BODY,
                    fg=theme.COLOR_MUTED,
                    bg=theme.COLOR_BG,
                ).pack(side=tk.LEFT)

            # Controls row: Name box, Save name, Split, Merge
            controls_row = tk.Frame(card, bg=theme.COLOR_BG)
            controls_row.pack(fill=tk.X)

            tk.Label(
                controls_row,
                text="Name:",
                font=theme.FONT_BODY,
                fg=theme.COLOR_TEXT,
                bg=theme.COLOR_BG,
            ).pack(side=tk.LEFT, padx=(0, 6))

            current_name = group.get("display_name") or group.get("name") or ""
            name_var = tk.StringVar(value=current_name)
            name_entry = ttk.Entry(controls_row, textvariable=name_var, font=theme.FONT_BODY, width=20)
            name_entry.pack(side=tk.LEFT, padx=(0, 8))

            def make_save_cmd(g_id=gid, v=name_var):
                def save_action():
                    raw = v.get().strip()
                    try:
                        clean_saved = self.people_manager.name_group(g_id, raw)
                        messagebox.showinfo("Saved", f"Group updated as '{clean_saved}'.")
                        self.render_people_cards()
                    except ValueError as err:
                        messagebox.showerror("Invalid Name", str(err))
                return save_action

            save_btn = tk.Button(
                controls_row,
                text="Save name",
                command=make_save_cmd(),
                font=theme.FONT_BODY,
                bg=theme.COLOR_SECONDARY_BG,
                fg=theme.COLOR_SECONDARY_TEXT,
                relief=tk.SOLID,
                bd=1,
                padx=10,
                pady=3,
                cursor="hand2",
            )
            save_btn.pack(side=tk.LEFT, padx=(0, 10))

            # Split control
            def make_split_cmd(g_id=gid):
                def split_action():
                    try:
                        orig_id, new_id = self.people_manager.split_group(g_id)
                        messagebox.showinfo("Split", f"Group split into {orig_id} and {new_id}.")
                        self.render_people_cards()
                    except ValueError as err:
                        messagebox.showerror("Cannot Split", str(err))
                return split_action

            split_btn = tk.Button(
                controls_row,
                text="Split",
                command=make_split_cmd(),
                font=theme.FONT_BODY,
                bg=theme.COLOR_SECONDARY_BG,
                fg=theme.COLOR_SECONDARY_TEXT,
                relief=tk.SOLID,
                bd=1,
                padx=10,
                pady=3,
                cursor="hand2",
            )
            split_btn.pack(side=tk.LEFT, padx=(0, 10))

            # Merge control: dropdown of other groups
            other_groups = [g["id"] for g in groups if g["id"] != gid]
            if other_groups:
                tk.Label(
                    controls_row,
                    text="Merge into:",
                    font=theme.FONT_BODY,
                    fg=theme.COLOR_TEXT,
                    bg=theme.COLOR_BG,
                ).pack(side=tk.LEFT, padx=(8, 4))

                merge_var = tk.StringVar(value=other_groups[0])
                merge_dropdown = ttk.Combobox(controls_row, textvariable=merge_var, values=other_groups, width=12, state="readonly")
                merge_dropdown.pack(side=tk.LEFT, padx=(0, 6))

                def make_merge_cmd(target_id_var=merge_var, src_id=gid):
                    def merge_action():
                        target_id = target_id_var.get()
                        if target_id and target_id != src_id:
                            if self.people_manager.would_guard_refuse_merge(target_id, src_id):
                                n_faces = self.people_manager.get_group_size(src_id)
                                m_faces = self.people_manager.get_group_size(target_id)
                                confirmed = messagebox.askyesno(
                                    "Confirm Merge",
                                    f"This merges {n_faces} faces into a group of {m_faces} faces. Continue?",
                                )
                                if not confirmed:
                                    return
                            merged_ok = self.people_manager.merge_groups(target_id, src_id, is_automatic=False)
                            if merged_ok:
                                messagebox.showinfo("Merged", f"Group {src_id} merged into {target_id}.")
                            self.render_people_cards()
                    return merge_action

                merge_btn = tk.Button(
                    controls_row,
                    text="Merge",
                    command=make_merge_cmd(),
                    font=theme.FONT_BODY,
                    bg=theme.COLOR_SECONDARY_BG,
                    fg=theme.COLOR_SECONDARY_TEXT,
                    relief=tk.SOLID,
                    bd=1,
                    padx=8,
                    pady=3,
                    cursor="hand2",
                )
                merge_btn.pack(side=tk.LEFT)

        # Withheld photos section at bottom of People screen
        withheld_frame = tk.Frame(
            self.people_scroll_frame,
            bg=theme.COLOR_CARD_BG,
            highlightbackground=theme.COLOR_CARD_BORDER,
            highlightthickness=1,
            padx=14,
            pady=12,
        )
        withheld_frame.pack(fill=tk.X, expand=True, pady=(12, 10))

        tk.Label(
            withheld_frame,
            text="Photos Withheld From Placement",
            font=theme.FONT_SECTION,
            fg=theme.COLOR_TEXT,
            bg=theme.COLOR_CARD_BG,
        ).pack(anchor=tk.W, pady=(0, 4))

        withheld_report = self.people_manager.get_withheld_photos_report()
        total_withheld = (
            len(withheld_report["needs_review"])
            + len(withheld_report["unnamed"])
            + len(withheld_report["hidden_group"])
        )

        if total_withheld == 0:
            tk.Label(
                withheld_frame,
                text="All detected faces belong to active named groups. No photos are currently withheld.",
                font=theme.FONT_BODY,
                fg="#059669",
                bg=theme.COLOR_CARD_BG,
            ).pack(anchor=tk.W)
        else:
            tk.Label(
                withheld_frame,
                text="These photos will use Name rule, Date rule, or Unsorted/ until their group is named or reviewed:",
                font=theme.FONT_BODY,
                fg=theme.COLOR_MUTED,
                bg=theme.COLOR_CARD_BG,
            ).pack(anchor=tk.W, pady=(0, 6))

            if withheld_report["needs_review"]:
                unique_nr = sorted({item["file_name"] for item in withheld_report["needs_review"]})
                nr_sub = tk.Frame(withheld_frame, bg=theme.COLOR_CARD_BG)
                nr_sub.pack(fill=tk.X, pady=(2, 4))
                tk.Label(
                    nr_sub,
                    text=f"* Needs review ({len(unique_nr)} photos in large groups):",
                    font=theme.FONT_BODY_BOLD,
                    fg="#DC2626",
                    bg=theme.COLOR_CARD_BG,
                ).pack(anchor=tk.W)
                sample_nr = ", ".join(unique_nr[:6]) + (f" (+{len(unique_nr) - 6} more)" if len(unique_nr) > 6 else "")
                tk.Label(
                    nr_sub,
                    text=f"  {sample_nr}",
                    font=theme.FONT_BODY,
                    fg=theme.COLOR_MUTED,
                    bg=theme.COLOR_CARD_BG,
                ).pack(anchor=tk.W, padx=(12, 0))

            if withheld_report["unnamed"]:
                unique_un = sorted({item["file_name"] for item in withheld_report["unnamed"]})
                un_sub = tk.Frame(withheld_frame, bg=theme.COLOR_CARD_BG)
                un_sub.pack(fill=tk.X, pady=(2, 4))
                tk.Label(
                    un_sub,
                    text=f"* Unnamed groups ({len(unique_un)} photos in groups with >= 2 faces):",
                    font=theme.FONT_BODY_BOLD,
                    fg="#D97706",
                    bg=theme.COLOR_CARD_BG,
                ).pack(anchor=tk.W)
                sample_un = ", ".join(unique_un[:6]) + (f" (+{len(unique_un) - 6} more)" if len(unique_un) > 6 else "")
                tk.Label(
                    un_sub,
                    text=f"  {sample_un}",
                    font=theme.FONT_BODY,
                    fg=theme.COLOR_MUTED,
                    bg=theme.COLOR_CARD_BG,
                ).pack(anchor=tk.W, padx=(12, 0))

            if withheld_report["hidden_group"]:
                unique_hg = sorted({item["file_name"] for item in withheld_report["hidden_group"]})
                hg_sub = tk.Frame(withheld_frame, bg=theme.COLOR_CARD_BG)
                hg_sub.pack(fill=tk.X, pady=(2, 4))
                tk.Label(
                    hg_sub,
                    text=f"* Hidden groups ({len(unique_hg)} photos in single-face clusters):",
                    font=theme.FONT_BODY_BOLD,
                    fg=theme.COLOR_TEXT,
                    bg=theme.COLOR_CARD_BG,
                ).pack(anchor=tk.W)
                sample_hg = ", ".join(unique_hg[:6]) + (f" (+{len(unique_hg) - 6} more)" if len(unique_hg) > 6 else "")
                tk.Label(
                    hg_sub,
                    text=f"  {sample_hg}",
                    font=theme.FONT_BODY,
                    fg=theme.COLOR_MUTED,
                    bg=theme.COLOR_CARD_BG,
                ).pack(anchor=tk.W, padx=(12, 0))

    def _show_unreadable_files_window(self) -> None:
        """Display read-only dialog listing all files that could not be opened or decoded."""
        win = tk.Toplevel(self.root)
        win.title("Unreadable Files")
        win.geometry("640x400")
        win.minsize(480, 300)
        win.configure(bg=theme.COLOR_BG)
        win.transient(self.root)

        header_frame = tk.Frame(win, bg=theme.COLOR_BG, padx=16, pady=12)
        header_frame.pack(fill=tk.X)

        count = len(self.cluster_manager.unreadable)
        tk.Label(
            header_frame,
            text=f"Files that could not be read ({count})",
            font=theme.FONT_SECTION,
            fg=theme.COLOR_TEXT,
            bg=theme.COLOR_BG,
        ).pack(anchor=tk.W)

        tk.Label(
            header_frame,
            text="These files could not be opened or decoded. They were not moved or altered.",
            font=theme.FONT_BODY,
            fg=theme.COLOR_MUTED,
            bg=theme.COLOR_BG,
        ).pack(anchor=tk.W, pady=(2, 0))

        content_frame = tk.Frame(win, bg=theme.COLOR_CARD_BG, padx=8, pady=8)
        content_frame.pack(fill=tk.BOTH, expand=True, padx=16, pady=(0, 12))

        txt = tk.Text(
            content_frame,
            wrap=tk.WORD,
            font=theme.FONT_BODY,
            bg=theme.COLOR_CARD_BG,
            fg=theme.COLOR_TEXT,
            relief=tk.FLAT,
            padx=8,
            pady=8,
        )
        scroll = ttk.Scrollbar(content_frame, orient=tk.VERTICAL, command=txt.yview)
        txt.configure(yscrollcommand=scroll.set)
        txt.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        scroll.pack(side=tk.RIGHT, fill=tk.Y)

        if not self.cluster_manager.unreadable:
            txt.insert(tk.END, "No unreadable files found.\n")
        else:
            for p_str in sorted(self.cluster_manager.unreadable):
                txt.insert(tk.END, f"{p_str}\n")
        txt.configure(state=tk.DISABLED)

        btn_frame = tk.Frame(win, bg=theme.COLOR_BG, padx=16, pady=0)
        btn_frame.pack(fill=tk.X, pady=(0, 12))

        tk.Button(
            btn_frame,
            text="Close",
            command=win.destroy,
            font=theme.FONT_BODY,
            bg=theme.COLOR_SECONDARY_BG,
            fg=theme.COLOR_SECONDARY_TEXT,
            relief=tk.SOLID,
            bd=1,
            padx=14,
            pady=4,
            cursor="hand2",
        ).pack(side=tk.RIGHT)

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

    def _set_approve_button_state(self, enabled: bool) -> None:
        if enabled:
            self.approve_btn.config(
                state=tk.NORMAL,
                bg=theme.COLOR_PRIMARY,
                fg=theme.COLOR_PRIMARY_TEXT,
                cursor="hand2",
            )
        else:
            self.approve_btn.config(
                state=tk.DISABLED,
                bg=theme.COLOR_PRIMARY_DISABLED,
                fg=theme.COLOR_PRIMARY_TEXT,
                cursor="arrow",
            )

    def _set_start_button_state(self, enabled: bool) -> None:
        self._set_approve_button_state(enabled)

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

    def _on_scan_people_click(self) -> None:
        """Scan source folder for all images and videos in a background stoppable thread."""
        src = self.source_dir.get().strip()
        if not src or not Path(src).is_dir():
            messagebox.showwarning("Missing Source", "Please select a valid source folder first.")
            return

        src_path = Path(src)
        self.is_running = True
        self.scan_stop_event = threading.Event()

        self._set_preview_button_state(False)
        self._set_approve_button_state(False)
        self.scan_people_btn.config(state=tk.DISABLED)

        self.stop_scan_btn.pack(side=tk.LEFT, padx=(0, 8))
        self.progress_bar.pack(side=tk.RIGHT, fill=tk.X, expand=True, padx=(16, 0))
        self.progress_bar["mode"] = "determinate"
        self.progress_bar["maximum"] = 100
        self.progress_bar["value"] = 0
        self.status_var.set("Scanning images and videos for people...")

        def progress(scanned: int, total: int, faces: int) -> None:
            self.root.after(0, self._scan_progress, scanned, total, faces)

        def worker() -> None:
            try:
                summary = self.cluster_manager.scan_source(
                    src_path,
                    progress_callback=progress,
                    stop_event=self.scan_stop_event,
                )
                self.root.after(0, self._scan_finished, summary)
            except Exception as e:
                self.root.after(0, self._scan_error, str(e))

        threading.Thread(target=worker, daemon=True).start()

    def _on_stop_scan_click(self) -> None:
        """Signal the background scan to stop gracefully after current batch."""
        if self.scan_stop_event:
            self.scan_stop_event.set()
            self.status_var.set("Stopping scan after current batch...")

    def _scan_progress(self, scanned: int, total: int, faces: int) -> None:
        self.progress_bar["maximum"] = max(total, 1)
        self.progress_bar["value"] = scanned
        self.status_var.set(f"Scanned {scanned} of {total}. Results saved.")

    def _scan_finished(self, summary: dict[str, int]) -> None:
        self.is_running = False
        self.stop_scan_btn.pack_forget()
        self.progress_bar.pack_forget()
        self._set_preview_button_state(True)
        self.scan_people_btn.config(state=tk.NORMAL)

        msg = (
            f"People scan complete: {summary['images_scanned']} files scanned, "
            f"{summary['faces_found']} faces across {summary['groups_count']} groups."
        )
        self.status_var.set(msg)
        messagebox.showinfo("Scan Complete", msg)

        # Refresh people tab and switch to it if groups were found
        self.render_people_cards()
        if summary.get("groups_count", 0) > 0:
            self.notebook.select(self.tab_people)

    def _scan_error(self, err_msg: str) -> None:
        self.is_running = False
        self.stop_scan_btn.pack_forget()
        self.progress_bar.pack_forget()
        self._set_preview_button_state(True)
        self.scan_people_btn.config(state=tk.NORMAL)
        self.status_var.set("Scan error")
        messagebox.showerror("Scan Error", err_msg)

    def _on_preview_click(self) -> None:
        src = self.source_dir.get().strip()
        dst = self.dest_dir.get().strip()

        if not src or not dst:
            messagebox.showwarning("Missing Folders", "Please select both source and destination folders.")
            return

        src_path = Path(src)
        dst_path = Path(dst)

        self._set_preview_button_state(False)
        self._set_approve_button_state(False)
        self.status_var.set("Scanning source folder and generating preview...")

        def worker() -> None:
            try:
                self.cluster_manager.load()
                face_data = self.people_manager.get_face_data_for_plan()
                plan = build_plan(src_path, dst_path, face_data=face_data)
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
        self._set_approve_button_state(ready_count > 0)

    def _preview_error(self, err_msg: str) -> None:
        self._set_preview_button_state(True)
        self._set_approve_button_state(False)
        self.status_var.set("Preview error")
        messagebox.showerror("Error Building Plan", err_msg)

    def _on_approve_click(self) -> None:
        """Approve planned moves with confirmation dialog showing count and safety rule."""
        if not self.current_plan:
            return

        ready_moves = [m for m in self.current_plan if m.status == "ready"]
        if not ready_moves:
            messagebox.showinfo("No Files", "There are no files ready to move.")
            return

        # Confirmation dialog with move count and exact rule "Files are moved, not copied."
        confirm = messagebox.askyesno(
            "Confirm Move",
            f"Move {len(ready_moves)} files?\n\nFiles are moved, not copied. Nothing is deleted.",
        )
        if not confirm:
            return

        self.is_running = True
        self._set_preview_button_state(False)
        self._set_approve_button_state(False)
        self.undo_btn.config(state=tk.DISABLED, bg="#F3F4F6", fg=theme.COLOR_SECONDARY_DISABLED_TEXT, cursor="arrow")

        self.progress_bar.pack(side=tk.RIGHT, fill=tk.X, expand=True, padx=(16, 0))
        self.progress_bar["mode"] = "determinate"
        self.progress_bar["maximum"] = len(ready_moves)
        self.progress_bar["value"] = 0
        self.status_var.set("Moving files...")

        runs_dir = get_runs_dir()
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        run_folder = runs_dir / f"run_{timestamp}"
        log_path = run_folder / "run.log"

        def worker() -> None:
            try:
                summary = run_plan(self.current_plan, log_path)
                self.root.after(0, self._move_finished, summary, log_path)
            except Exception as e:
                self.root.after(0, self._move_error, str(e))

        threading.Thread(target=worker, daemon=True).start()

    def _move_finished(self, summary: dict, log_path: Path) -> None:
        self.is_running = False
        self.progress_bar.pack_forget()
        self._set_preview_button_state(True)

        if summary.get("stopped"):
            self.status_var.set(f"Stopped: {summary.get('reason')}")
            messagebox.showerror("Run Stopped", summary.get("reason"))
        else:
            self.status_var.set(f"Run completed: {summary.get('moved')} moved, {summary.get('skipped')} skipped.")
            messagebox.showinfo("Complete", f"Successfully moved {summary.get('moved')} files.")

        self.current_plan = []
        self._set_approve_button_state(False)
        self.update_undo_button_state()

    def _move_error(self, err_msg: str) -> None:
        self.is_running = False
        self.progress_bar.pack_forget()
        self._set_preview_button_state(True)
        self._set_approve_button_state(False)
        self.update_undo_button_state()
        self.status_var.set("Move failed")
        messagebox.showerror("Move Error", err_msg)

    _on_start_click = _on_approve_click

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
        self._set_approve_button_state(False)
        self.undo_btn.config(state=tk.DISABLED, bg="#F3F4F6", fg=theme.COLOR_SECONDARY_DISABLED_TEXT, cursor="arrow")

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
    if multiprocessing.current_process().name != "MainProcess":
        return
    root = tk.Tk()
    NexoraApp(root)
    root.mainloop()


if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
