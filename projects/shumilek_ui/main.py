from __future__ import annotations

import atexit
import faulthandler
import math
import os
from queue import Empty, SimpleQueue
import tempfile
import threading
import time
import tkinter as tk
import webbrowser
from pathlib import Path
from tkinter import filedialog, ttk
from urllib import error as urlerror
from urllib import request as urlrequest

try:
    from asset_cache import browser_url_for_path, describe_visual_bootstrap_state_issue, ensure_asset_cached, export_cached_asset, load_visual_bootstrap_state, save_visual_bootstrap_state, suggested_asset_name
    from pixellab_bridge import PixelLabBridge, get_remote_auth_headers
    from scene import PALETTE, build_sidebar_blocks, find_node
    from ui_helpers import DEFAULT_SERVER_STYLE_PRESET, SERVER_STYLE_PRESETS, asset_action_url, asset_activity_tone, asset_ready_counts, asset_ready_jobs, bridge_activity_tone, build_asset_activity_text, build_bridge_activity_text, build_asset_link_text, build_tracked_job_detail, cache_refresh_targets, choose_asset_job, choose_preview_url, compose_character_prompt, compose_tileset_prompts, normalize_poll_interval_seconds, normalize_server_style_preset, server_style_preset_label, should_apply_preview_result, should_reload_preview, summarize_asset_history_entry, summarize_tracked_job_entry
    from ui_settings import load_ui_settings, save_ui_settings
except ImportError:
    from .asset_cache import browser_url_for_path, describe_visual_bootstrap_state_issue, ensure_asset_cached, export_cached_asset, load_visual_bootstrap_state, save_visual_bootstrap_state, suggested_asset_name
    from .pixellab_bridge import PixelLabBridge, get_remote_auth_headers
    from .scene import PALETTE, build_sidebar_blocks, find_node
    from .ui_helpers import DEFAULT_SERVER_STYLE_PRESET, SERVER_STYLE_PRESETS, asset_action_url, asset_activity_tone, asset_ready_counts, asset_ready_jobs, bridge_activity_tone, build_asset_activity_text, build_bridge_activity_text, build_asset_link_text, build_tracked_job_detail, cache_refresh_targets, choose_asset_job, choose_preview_url, compose_character_prompt, compose_tileset_prompts, normalize_poll_interval_seconds, normalize_server_style_preset, server_style_preset_label, should_apply_preview_result, should_reload_preview, summarize_asset_history_entry, summarize_tracked_job_entry
    from .ui_settings import load_ui_settings, save_ui_settings


class PixelWorkspaceApp:
    FONT_UI = "Consolas"
    FONT_UI_BOLD = "Consolas"
    FONT_CODE = "Consolas"
    INITIAL_LIVE_SYNC_TIMEOUT_SECONDS = 8.0
    SESSION_LOG_RETENTION_SECONDS = 7 * 24 * 60 * 60
    SESSION_LOG_PREFIXES = (
        "shumilek_pixel_workspace",
        "shumilek_ui_fault",
    )
    STATUS_TONE_COLORS = {
        "idle": PALETTE["muted"],
        "busy": PALETTE["gold"],
        "ready": PALETTE["leaf"],
        "alert": PALETTE["rose"],
    }
    ASSET_SOURCE_BADGES = {
        "waiting": ("SOURCE: waiting", "idle"),
        "live-processing": ("SOURCE: live processing", "busy"),
        "live-ready": ("SOURCE: live ready", "ready"),
        "cached-bootstrap": ("SOURCE: cached bootstrap", "busy"),
    }

    @staticmethod
    def _build_session_log_path(prefix: str, session_id: str, base_dir: Path | None = None) -> Path:
        log_dir = base_dir or Path(tempfile.gettempdir())
        return log_dir / f"{prefix}_{session_id}.log"

    @staticmethod
    def _format_runtime_session_text(session_id: str | None) -> str:
        normalized = str(session_id or "").strip() or "unknown"
        return f"SESSION: {normalized}"

    @staticmethod
    def _format_runtime_log_paths_text(external_log_path: Path | None, fault_log_path: Path | None) -> str:
        external_text = external_log_path.name if isinstance(external_log_path, Path) else "unknown"
        fault_text = fault_log_path.name if isinstance(fault_log_path, Path) else "unknown"
        return f"TRACE: {external_text}\nFAULT: {fault_text}"

    def __init__(self) -> None:
        self.root = tk.Tk()
        self.close_requested = False
        self.root.title("Shumilek - Pixel Workspace")
        self.root.geometry("1440x920")
        self.root.minsize(1220, 760)
        self.root.configure(bg=PALETTE["sky_glow"])
        self.ui_callback_queue: SimpleQueue[object] = SimpleQueue()
        self.ui_callback_after_id: str | None = None

        self.selected_node = tk.StringVar(value="Korunovy workspace")
        self.status_text = tk.StringVar(value="Aktualni task: Stavime prirodni pixel workspace pro Shumilka")
        self.bridge = PixelLabBridge()
        self._pixellab_auth_cache: dict[str, str] | None = None
        self.bridge_mode_text = tk.StringVar(value=f"PixelLab bridge: {self.bridge.get_mode_label()}")
        self.server_style_preset = tk.StringVar(value=DEFAULT_SERVER_STYLE_PRESET)
        self.server_style_preset_text = tk.StringVar(value=server_style_preset_label(DEFAULT_SERVER_STYLE_PRESET))
        self.character_prompt = tk.StringVar(value="graph navigator operator")
        self.tileset_lower = tk.StringVar(value="dark topology grid")
        self.tileset_upper = tk.StringVar(value="cyan teal node lattice")
        self.job_summary_text = tk.StringVar(value="Zatim bez queued jobu")
        self.tracked_job_detail_text = tk.StringVar(value="Vyber tracked job pro detail stavu, promptu a asset linku.")
        self.tracked_job_full_detail_text = "Vyber tracked job pro detail stavu, promptu a asset linku."
        self.bridge_activity_text = tk.StringVar(value="Queue is idle.")
        self.auto_poll_enabled = tk.BooleanVar(value=False)
        self.auto_poll_seconds = tk.IntVar(value=3)
        self.asset_status_text = tk.StringVar(value="Preview se ukaze po dokonceni live jobu.")
        self.asset_source_badge_text = tk.StringVar(value=self.ASSET_SOURCE_BADGES["waiting"][0])
        self.asset_activity_text = tk.StringVar(value="Waiting for the first ready asset.")
        self.asset_meta_text = tk.StringVar(value="Zatim neni k dispozici zadny hotovy asset.")
        self.asset_link_text = tk.StringVar(value="")
        self.asset_cache_text = tk.StringVar(value="Cache: zatim prazdna")
        self.current_preview_image: tk.PhotoImage | None = None
        self.current_stage_image: tk.PhotoImage | None = None
        self.current_hero_image: tk.PhotoImage | None = None
        self.loaded_preview_url = ""
        self.pending_preview_url = ""
        self.active_visual_title = ""
        self.active_visual_subtitle = ""
        self.active_visual_job_type = ""
        self.server_visual_text = tk.StringVar(value="PixelLab server feed ceka na prvni ready asset.")
        self.preview_request_id = 0
        self.preview_asset_url = ""
        self.download_asset_url = ""
        self.asset_history_job_id = ""
        self.asset_history_filter = tk.StringVar(value="all")
        self.asset_history_filter_labels = {
            "all": tk.StringVar(value="All (0)"),
            "character": tk.StringVar(value="Characters (0)"),
            "tileset": tk.StringVar(value="Tilesets (0)"),
        }
        self.asset_history_ids: list[str] = []
        self.tracked_job_ids: list[str] = []
        self.tracked_job_id = ""
        self.asset_history_user_selected = False
        self.updating_asset_history = False
        self.updating_tracked_jobs = False
        self.ui_settings_save_error = ""
        self.cache_refresh_request_id = 0
        self.cache_refresh_in_progress = False
        self.asset_action_request_seq = 0
        self.asset_action_request_ids: dict[str, int] = {}
        self.asset_action_in_progress: set[str] = set()
        self.asset_activity_error = ""
        self.bridge_action_request_seq = 0
        self.bridge_action_request_ids: dict[str, int] = {}
        self.bridge_action_in_progress: set[str] = set()
        self.bridge_activity_error = ""
        self.poll_debounce_after_id: str | None = None
        self.poll_follow_up_requested = False
        self.auto_poll_after_id: str | None = None
        self.bootstrap_poll_after_id: str | None = None
        self.bootstrap_visual_generation_requested = False
        self.bootstrap_poll_attempts_remaining = 0
        self.cached_preview_path: Path | None = None
        self.cached_preview_source_url = ""
        self.cached_download_path: Path | None = None
        self.cached_download_source_url = ""
        self.scene_node_regions: dict[str, tuple[int, int, int, int]] = {}
        self.library_items: list[dict[str, str]] = []
        self.library_loading = False
        self.library_count_text = tk.StringVar(value="Characters: 0  Tilesets: 0")
        self.log_lines = [
            "14:26  Lesni brana otevrena",
            "14:27  Korunovy workspace rozkreslen",
            "14:28  PixelLab paseka pripraveno",
            "14:29  Dalsi krok: aktivni asset generator",
        ]
        self.runtime_session_id = f"{int(time.time() * 1000)}-{os.getpid()}"
        self.runtime_session_text = tk.StringVar(value=self._format_runtime_session_text(self.runtime_session_id))
        self.external_log_path = self._build_session_log_path("shumilek_pixel_workspace", self.runtime_session_id)
        self.fault_log_path = self._build_session_log_path("shumilek_ui_fault", self.runtime_session_id)
        self.runtime_log_paths_text = tk.StringVar(value=self._format_runtime_log_paths_text(self.external_log_path, self.fault_log_path))
        self.fault_log_handle = None
        removed_log_count = self._cleanup_stale_session_logs()
        self._write_external_log_line(f"15:00  Startup session: {self.runtime_session_id}")
        if removed_log_count:
            self._write_external_log_line(f"15:00  Cleaned stale session logs: {removed_log_count}")
        self._configure_fault_handler()
        atexit.register(self._write_external_log_line, "15:06  Process exiting via atexit")

        self._load_ui_preferences()
        self._configure_style()
        self._build_layout()
        self._configure_close_behavior()
        self._schedule_ui_callback_drain()
        self._set_asset_source_badge("waiting")
        self._apply_initial_ui_state()

    def _configure_close_behavior(self) -> None:
        protocol = getattr(self.root, "protocol", None)
        if callable(protocol):
            try:
                protocol("WM_DELETE_WINDOW", self._on_close_requested)
            except (AttributeError, RuntimeError, tk.TclError):
                pass

        bind = getattr(self.root, "bind", None)
        if not callable(bind):
            return
        try:
            bind("<Destroy>", self._on_root_destroy, add="+")
        except (AttributeError, RuntimeError, tk.TclError):
            return

    def _configure_fault_handler(self) -> None:
        if getattr(self, "fault_log_handle", None) is not None:
            return
        log_path = getattr(self, "fault_log_path", None)
        if not isinstance(log_path, Path):
            return
        try:
            log_path.parent.mkdir(parents=True, exist_ok=True)
            self.fault_log_handle = log_path.open("a", encoding="utf-8")
            faulthandler.enable(self.fault_log_handle, all_threads=True)
        except (AttributeError, OSError, RuntimeError):
            self.fault_log_handle = None
            return
        session_id = getattr(self, "runtime_session_id", "unknown")
        self._write_fault_log_line(f"15:00  Fault session: {session_id}")
        self._write_external_log_line(f"15:06  Fault handler trace enabled: {log_path}")

    def _cleanup_stale_session_logs(self, now: float | None = None, base_dir: Path | None = None) -> int:
        log_dir = base_dir or Path(tempfile.gettempdir())
        retention_seconds = getattr(self, "SESSION_LOG_RETENTION_SECONDS", self.SESSION_LOG_RETENTION_SECONDS)
        prefixes = getattr(self, "SESSION_LOG_PREFIXES", self.SESSION_LOG_PREFIXES)
        current_time = time.time() if now is None else now
        cutoff = current_time - retention_seconds
        protected_paths = {
            path
            for path in (
                getattr(self, "external_log_path", None),
                getattr(self, "fault_log_path", None),
            )
            if isinstance(path, Path)
        }
        removed_count = 0

        for prefix in prefixes:
            for log_path in log_dir.glob(f"{prefix}_*.log"):
                if log_path in protected_paths or not log_path.is_file():
                    continue
                try:
                    if log_path.stat().st_mtime >= cutoff:
                        continue
                    log_path.unlink()
                except OSError:
                    continue
                removed_count += 1
        return removed_count

    def _close_fault_handler(self) -> None:
        handle = getattr(self, "fault_log_handle", None)
        if handle is None:
            return
        session_id = getattr(self, "runtime_session_id", "unknown")
        self._write_fault_log_line(f"15:06  Fault handler trace closing | session={session_id}")
        try:
            faulthandler.disable()
        except RuntimeError:
            pass
        try:
            handle.close()
        except OSError:
            pass
        self.fault_log_handle = None

    def __del__(self) -> None:
        self._close_fault_handler()

    def _safe_after_cancel(self, after_id: str | None) -> None:
        if not after_id:
            return
        try:
            self.root.after_cancel(after_id)
        except (AttributeError, RuntimeError, tk.TclError):
            return

    def _cancel_scheduled_callbacks(self) -> None:
        self._safe_after_cancel(getattr(self, "ui_callback_after_id", None))
        self.ui_callback_after_id = None
        self._safe_after_cancel(getattr(self, "poll_debounce_after_id", None))
        self.poll_debounce_after_id = None
        self._safe_after_cancel(getattr(self, "auto_poll_after_id", None))
        self.auto_poll_after_id = None
        self._safe_after_cancel(getattr(self, "bootstrap_poll_after_id", None))
        self.bootstrap_poll_after_id = None

    def _on_close_requested(self) -> None:
        if getattr(self, "close_requested", False):
            return
        self._safe_append_log("15:06  UI close requested")
        self.close_requested = True
        self._cancel_scheduled_callbacks()
        try:
            self.root.destroy()
        except (AttributeError, RuntimeError, tk.TclError):
            return

    def _on_root_destroy(self, event: tk.Event | None = None) -> None:
        if event is not None and getattr(event, "widget", None) is not getattr(self, "root", None):
            return
        self._safe_append_log(f"15:06  UI root destroy event | {self._ui_runtime_state_summary()}")

    def _dispatch_to_ui(self, callback: object) -> None:
        if not callable(callback):
            return
        queue = getattr(self, "ui_callback_queue", None)
        if queue is None:
            callback()
            return
        queue.put(callback)

    def _get_pixellab_auth(self) -> dict[str, str] | None:
        if self._pixellab_auth_cache is None:
            headers = get_remote_auth_headers()
            self._pixellab_auth_cache = headers if headers else {}
        return self._pixellab_auth_cache or None

    def _auth_for_url(self, url: str) -> dict[str, str] | None:
        if "api.pixellab.ai" in url:
            return self._get_pixellab_auth()
        return None

    def _schedule_ui_callback_drain(self, delay_ms: int = 30) -> None:
        if getattr(self, "ui_callback_after_id", None) is not None:
            return
        try:
            self.ui_callback_after_id = self.root.after(delay_ms, self._drain_ui_callback_queue)
        except (AttributeError, RuntimeError, tk.TclError):
            self.ui_callback_after_id = None

    def _drain_ui_callback_queue(self) -> None:
        self.ui_callback_after_id = None
        queue = getattr(self, "ui_callback_queue", None)
        if queue is None:
            return
        while True:
            try:
                callback = queue.get_nowait()
            except Empty:
                break
            if callable(callback):
                callback()
        self._schedule_ui_callback_drain()

    def _apply_initial_ui_state(self) -> None:
        if getattr(getattr(self, "bridge", None), "has_live_tools", False):
            if not self.auto_poll_enabled.get():
                self.auto_poll_enabled.set(True)
            self._restore_cached_bootstrap_visual()
            self.status_text.set("Syncing PixelLab jobs...")
            if self._sync_initial_live_jobs():
                return
            if self._live_automation_enabled():
                self._seed_live_jobs_async()
                self._seed_tileset_jobs_async()
                self._poll_jobs()
            else:
                self._refresh_bridge_activity_text()
            return
        if self.auto_poll_enabled.get():
            self._schedule_auto_poll(500)
        else:
            self._refresh_bridge_activity_text()
        self._maybe_bootstrap_server_visuals()

    def _live_automation_enabled(self) -> bool:
        auto_poll_enabled = getattr(self, "auto_poll_enabled", None)
        if auto_poll_enabled is None:
            return True
        getter = getattr(auto_poll_enabled, "get", None)
        if not callable(getter):
            return bool(auto_poll_enabled)
        return bool(getter())

    def _sync_initial_live_jobs(self) -> bool:
        refresh_result: dict[str, object] = {"jobs": None, "error": None}

        def run_initial_refresh() -> None:
            try:
                refresh_result["jobs"] = self.bridge.refresh_jobs()
            except (OSError, RuntimeError, ValueError, urlerror.URLError, TimeoutError) as error:
                refresh_result["error"] = error

        worker = threading.Thread(target=run_initial_refresh, daemon=True)
        worker.start()
        worker.join(self.INITIAL_LIVE_SYNC_TIMEOUT_SECONDS)
        if worker.is_alive():
            self.bridge_activity_error = "Initial PixelLab sync timed out"
            self.status_text.set("Initial PixelLab sync timed out, polling in background...")
            self._append_log("15:01  Initial PixelLab sync timed out")
            return False

        error = refresh_result["error"]
        if error is not None:
            self.bridge_activity_error = str(error)
            return False

        try:
            jobs = list(refresh_result["jobs"] or [])
        except TypeError:
            self.bridge_activity_error = "Initial PixelLab sync returned invalid data"
            return False

        self.bridge_activity_error = ""
        self.status_text.set(f"PixelLab sync complete: {len(jobs)} jobu")
        self._append_log(f"15:01  Initial PixelLab sync: {len(jobs)} tracked")
        self._refresh_job_summary()
        self._refresh_asset_preview()

        if not jobs and self._live_automation_enabled():
            self._maybe_bootstrap_server_visuals()
        elif self._has_ready_tileset_job(jobs):
            self.bootstrap_visual_generation_requested = False
            self._cancel_bootstrap_poll()
        elif not self._has_tileset_job(jobs) and self._live_automation_enabled():
            self._maybe_bootstrap_server_visuals()
        elif self.bootstrap_visual_generation_requested and self._live_automation_enabled():
            self._schedule_bootstrap_poll(2500)
        elif self._live_automation_enabled():
            self.bootstrap_visual_generation_requested = True
            self._schedule_bootstrap_poll(2500)

        if self.auto_poll_enabled.get():
            self._schedule_auto_poll(500)
        else:
            self._refresh_bridge_activity_text()
        return True

    def _seed_live_jobs_async(self) -> None:
        worker = threading.Thread(target=self._seed_live_jobs_worker, daemon=True)
        worker.start()

    def _seed_tileset_jobs_async(self) -> None:
        worker = threading.Thread(target=self._seed_tileset_jobs_worker, daemon=True)
        worker.start()

    def _seed_live_jobs_worker(self) -> None:
        try:
            jobs = self.bridge.seed_jobs_for_ui()
        except (AttributeError, OSError, RuntimeError, ValueError, urlerror.URLError, TimeoutError):
            return
        self._dispatch_to_ui(lambda: self._apply_seed_live_jobs(jobs))

    def _seed_tileset_jobs_worker(self) -> None:
        try:
            jobs = self.bridge.seed_tileset_jobs_for_ui()
        except (AttributeError, OSError, RuntimeError, ValueError, urlerror.URLError, TimeoutError):
            return
        self._dispatch_to_ui(lambda: self._apply_seed_live_jobs(jobs, promote_tileset=True))

    def _apply_seed_live_jobs(self, jobs: list[object], promote_tileset: bool = False) -> None:
        if not jobs:
            return
        if promote_tileset and not self.asset_history_user_selected:
            has_ready_tileset = any(
                getattr(job, "job_type", "") == "tileset"
                and str(getattr(job, "status", "")).strip().lower() == "ready"
                and (getattr(job, "preview_url", "") or getattr(job, "download_url", ""))
                for job in jobs
            )
            if has_ready_tileset and self.active_visual_job_type != "tileset":
                self.asset_history_job_id = ""
        elif getattr(self, "asset_history_job_id", ""):
            return
        self.status_text.set(f"PixelLab seed ready: {len(jobs)} jobu")
        self._refresh_job_summary()
        self._refresh_asset_preview()

    def _restore_cached_bootstrap_visual(self) -> bool:
        session_id = getattr(self, "runtime_session_id", "unknown")
        cached_visual = load_visual_bootstrap_state()
        if not cached_visual:
            issue = describe_visual_bootstrap_state_issue()
            if issue:
                self._safe_append_log(f"15:00  Cached PixelLab world bootstrap skipped: {issue} | session={session_id}")
            return False
        job_type = str(cached_visual.get("job_type") or "").strip().lower()
        if job_type != "tileset":
            self._safe_append_log(f"15:00  Cached PixelLab world bootstrap skipped: unsupported job_type={job_type or 'unknown'} | session={session_id}")
            return False

        cached_path = Path(cached_visual["cached_path"])
        self._safe_append_log(f"15:00  Cached PixelLab world bootstrap candidate: {cached_path} | session={session_id}")
        try:
            image = tk.PhotoImage(file=str(cached_path))
        except (RuntimeError, tk.TclError):
            self._safe_append_log(f"15:00  Cached PixelLab world bootstrap skipped: failed to load cached image {cached_path} | session={session_id}")
            return False

        title = cached_visual.get("title") or "Cached PixelLab world"
        subtitle = cached_visual.get("subtitle") or "Last known ready tileset"
        cached_subtitle = f"{subtitle} | cached bootstrap"
        preview_url = cached_visual.get("preview_url") or ""
        download_url = cached_visual.get("download_url") or ""

        self.active_visual_title = title
        self.active_visual_subtitle = cached_subtitle
        self.active_visual_job_type = "tileset"
        self.preview_asset_url = preview_url
        self.download_asset_url = download_url
        self.current_preview_image = image
        self.loaded_preview_url = preview_url
        self.cached_preview_path = cached_path
        self.cached_preview_source_url = preview_url
        self.asset_activity_error = ""
        self._set_asset_source_badge("cached-bootstrap")
        if hasattr(self, "asset_status_text"):
            self.asset_status_text.set(f"{title} | cached bootstrap")
        if hasattr(self, "asset_meta_text"):
            meta_lines = [
                "Source: cached bootstrap",
                f"Cached path: {cached_path}",
            ]
            if preview_url:
                meta_lines.append(f"Preview: {preview_url}")
            if download_url:
                meta_lines.append(f"Download: {download_url}")
            self.asset_meta_text.set("\n".join(meta_lines))
        if hasattr(self, "asset_link_text"):
            self.asset_link_text.set(build_asset_link_text(preview_url, download_url))
        self._refresh_asset_cache_text()
        self._refresh_asset_activity_text()
        if hasattr(self, "_refresh_asset_action_buttons"):
            self._refresh_asset_action_buttons()

        self.preview_canvas.delete("all")
        canvas_width = int(self.preview_canvas.cget("width"))
        canvas_height = int(self.preview_canvas.cget("height"))
        self.preview_canvas.create_rectangle(0, 0, canvas_width, canvas_height, fill=PALETTE["night_sky"], outline="")
        scaled = self._scale_photoimage_to_bounds(image, canvas_width - 8, canvas_height - 8, upscale_limit=8)
        self.current_preview_scaled = scaled
        self.preview_canvas.create_image(canvas_width // 2, canvas_height // 2, image=scaled)
        self._render_server_visual(image, title, cached_subtitle)
        self._append_log(f"15:00  Restored cached PixelLab world feed: {cached_path} | session={session_id}")
        return True

    def _configure_style(self) -> None:
        style = ttk.Style()
        style.theme_use("clam")
        style.configure(
            "Pixel.TFrame",
            background=PALETTE["night_sky"],
            borderwidth=0,
        )
        style.configure(
            "Panel.TFrame",
            background=PALETTE["panel"],
            borderwidth=0,
        )
        style.configure(
            "Pixel.TLabel",
            background=PALETTE["panel"],
            foreground=PALETTE["text"],
            font=(self.FONT_CODE, 12, "bold"),
        )
        style.configure(
            "Muted.TLabel",
            background=PALETTE["panel"],
            foreground=PALETTE["muted"],
            font=(self.FONT_CODE, 10),
        )
        style.configure(
            "Hero.TLabel",
            background=PALETTE["sky_glow"],
            foreground=PALETTE["text"],
            font=(self.FONT_CODE, 22, "bold"),
        )

    def _build_layout(self) -> None:
        self.root.grid_rowconfigure(0, weight=1)
        self.root.grid_columnconfigure(1, weight=1)

        left = tk.Frame(self.root, bg=PALETTE["panel"], width=360, highlightthickness=5, highlightbackground=PALETTE["panel_edge"])
        left.grid(row=0, column=0, sticky="nsew", padx=(12, 6), pady=12)
        left.grid_propagate(False)
        left.pack_propagate(False)

        center = tk.Frame(self.root, bg=PALETTE["sky_glow"])
        center.grid(row=0, column=1, sticky="nsew", padx=6, pady=12)
        center.grid_rowconfigure(0, weight=3, minsize=220)
        center.grid_rowconfigure(1, weight=2, minsize=200)
        center.grid_columnconfigure(0, weight=1)

        right = tk.Frame(self.root, bg=PALETTE["panel"], width=340, highlightthickness=5, highlightbackground=PALETTE["panel_edge"])
        right.grid(row=0, column=2, sticky="nsew", padx=(6, 12), pady=12)
        right.grid_propagate(False)
        right.pack_propagate(False)

        self._build_left_panel(left)
        self._build_center_panel(center)
        self._build_right_panel(right)

    def _panel_title(self, parent: tk.Widget, text: str) -> None:
        title_frame = tk.Frame(parent, bg=PALETTE["panel_edge"], highlightthickness=1, highlightbackground=PALETTE["gold"])
        title_frame.pack(fill="x", padx=10, pady=(8, 6))
        tk.Label(title_frame, text=text, bg=PALETTE["panel_edge"], fg=PALETTE["moon"], font=(self.FONT_CODE, 13, "bold"), anchor="w", padx=8, pady=4).pack(fill="x")

    def _section_caption(self, parent: tk.Widget, text: str, color: str, *, background: str | None = None, padx: int = 10, pady: tuple[int, int] = (8, 3)) -> None:
        tk.Label(
            parent,
            text=text,
            bg=background or PALETTE["panel_edge"],
            fg=color,
            font=(self.FONT_CODE, 10, "bold"),
            anchor="w",
            padx=6,
            pady=2,
        ).pack(fill="x", padx=padx, pady=pady)

    def _apply_status_card_tone(self, card: tk.Widget | None, title_label: tk.Widget | None, tone: str, *body_labels: tk.Widget | None) -> None:
        accent = self._blend_color(PALETTE["panel_edge"], self.STATUS_TONE_COLORS[tone], 0.7)
        body = self._blend_color(PALETTE["muted"], self.STATUS_TONE_COLORS[tone], 0.42)
        if card is not None:
            card.configure(highlightbackground=accent, highlightcolor=accent)
        if title_label is not None:
            title_label.configure(fg=self.STATUS_TONE_COLORS[tone])
        for body_label in body_labels:
            if body_label is not None:
                body_label.configure(fg=body)

    def _set_asset_source_badge(self, state: str) -> None:
        label_text, tone = self.ASSET_SOURCE_BADGES.get(state, self.ASSET_SOURCE_BADGES["waiting"])
        if hasattr(self, "asset_source_badge_text"):
            self.asset_source_badge_text.set(label_text)
        color = self.STATUS_TONE_COLORS[tone]
        for widget_name in ("sidebar_asset_source_label", "summary_asset_source_label", "preview_asset_source_label"):
            widget = getattr(self, widget_name, None)
            if widget is not None:
                widget.configure(fg=color)

    def _tracked_job_tone(self, status: str) -> str:
        normalized = status.strip().lower()
        if normalized in {"failed", "error", "cancelled", "canceled"}:
            return "alert"
        if normalized in {"queued", "processing", "running", "pending"}:
            return "busy"
        if normalized in {"ready", "done", "complete", "completed"}:
            return "ready"
        return "idle"

    def _apply_tracked_job_list_tone(self, index: int, status: str) -> None:
        if not hasattr(self, "tracked_job_listbox"):
            return
        tone = self._tracked_job_tone(status)
        color = self.STATUS_TONE_COLORS[tone]
        try:
            self.tracked_job_listbox.itemconfig(index, foreground=color, selectforeground=PALETTE["night_sky"])
        except (AttributeError, tk.TclError):
            return

    def _build_left_panel(self, parent: tk.Frame) -> None:
        self._panel_title(parent, "SHUMILEK")
        self._build_pixellab_form(parent)

        # --- TRACKED JOBS habitat ---
        jobs_panel = tk.Frame(parent, bg=PALETTE["panel_soft"], highlightthickness=3, highlightbackground=PALETTE["panel_edge"])
        jobs_panel.pack(fill="both", expand=True, padx=10, pady=(4, 4))
        self._section_caption(jobs_panel, "TRACKED JOBS", PALETTE["gold"])
        self.tracked_job_listbox = tk.Listbox(
            jobs_panel,
            height=5,
            bg=PALETTE["night_sky"],
            fg=PALETTE["moon"],
            selectbackground=PALETTE["gold"],
            selectforeground=PALETTE["night_sky"],
            highlightthickness=2,
            highlightbackground=PALETTE["panel_edge"],
            relief="flat",
            activestyle="none",
            exportselection=False,
            font=(self.FONT_CODE, 9),
        )
        self.tracked_job_listbox.pack(fill="both", expand=True, padx=10, pady=(0, 4))
        self.tracked_job_listbox.bind("<<ListboxSelect>>", self._on_tracked_job_select)
        tk.Label(jobs_panel, textvariable=self.tracked_job_detail_text, bg=PALETTE["panel_soft"], fg=PALETTE["muted"], font=(self.FONT_CODE, 8), anchor="w", justify="left", wraplength=320).pack(fill="x", padx=10, pady=(0, 2))
        tracked_job_actions = tk.Frame(jobs_panel, bg=PALETTE["panel_soft"])
        tracked_job_actions.pack(fill="x", padx=10, pady=(0, 6))
        self.copy_tracked_job_detail_button = self._build_action_button(
            tracked_job_actions, "Copy detail", self._copy_tracked_job_detail,
            PALETTE["cyan"], padx=0, state="disabled",
        )

        # --- STATUS card (bridge activity + job summary) ---
        self.sidebar_bridge_card = tk.Frame(parent, bg=PALETTE["panel_soft"], highlightthickness=3, highlightbackground=PALETTE["panel_edge"])
        self.sidebar_bridge_card.pack(fill="x", padx=10, pady=(0, 4))
        status_title_row = tk.Frame(self.sidebar_bridge_card, bg=PALETTE["panel_edge"])
        status_title_row.pack(fill="x")
        self.sidebar_bridge_title_label = tk.Label(status_title_row, text="STATUS", bg=PALETTE["panel_edge"], fg=PALETTE["leaf"], font=(self.FONT_CODE, 9, "bold"), anchor="w", padx=6, pady=2)
        self.sidebar_bridge_title_label.pack(side="left", fill="x", expand=True)
        self.open_logs_button = self._build_action_button(status_title_row, "Logs", self._open_runtime_log_directory, PALETTE["cyan"], padx=0)
        self.sidebar_bridge_activity_label = tk.Label(self.sidebar_bridge_card, textvariable=self.bridge_activity_text, bg=PALETTE["panel_soft"], fg=PALETTE["muted"], font=(self.FONT_CODE, 8), anchor="w", padx=6)
        self.sidebar_bridge_activity_label.pack(fill="x")
        self.sidebar_job_summary_label = tk.Label(self.sidebar_bridge_card, textvariable=self.job_summary_text, bg=PALETTE["panel_soft"], fg=PALETTE["text"], font=(self.FONT_CODE, 8), anchor="w", padx=6)
        self.sidebar_job_summary_label.pack(fill="x", pady=(0, 4))

        # --- ASSET card (source badge, activity, cache) ---
        self.sidebar_asset_card = tk.Frame(parent, bg=PALETTE["panel_soft"], highlightthickness=3, highlightbackground=PALETTE["panel_edge"])
        self.sidebar_asset_card.pack(fill="x", padx=10, pady=(0, 4))
        self.sidebar_asset_title_label = tk.Label(self.sidebar_asset_card, text="ASSET", bg=PALETTE["panel_edge"], fg=PALETTE["rose"], font=(self.FONT_CODE, 9, "bold"), anchor="w", padx=6, pady=2)
        self.sidebar_asset_title_label.pack(fill="x")
        self.sidebar_asset_source_label = tk.Label(self.sidebar_asset_card, textvariable=self.asset_source_badge_text, bg=PALETTE["panel_soft"], fg=PALETTE["muted"], font=(self.FONT_CODE, 8, "bold"), anchor="w", padx=6)
        self.sidebar_asset_source_label.pack(fill="x")
        self.sidebar_asset_activity_label = tk.Label(self.sidebar_asset_card, textvariable=self.asset_activity_text, bg=PALETTE["panel_soft"], fg=PALETTE["muted"], font=(self.FONT_CODE, 8), anchor="w", padx=6)
        self.sidebar_asset_activity_label.pack(fill="x")
        self.sidebar_asset_cache_label = tk.Label(self.sidebar_asset_card, textvariable=self.asset_cache_text, bg=PALETTE["panel_soft"], fg=PALETTE["muted"], font=(self.FONT_CODE, 8), anchor="w", padx=6)
        self.sidebar_asset_cache_label.pack(fill="x", pady=(0, 4))

        # Status bar at the bottom
        status_bar = tk.Frame(parent, bg=PALETTE["panel_edge"])
        status_bar.pack(fill="x", side="bottom", padx=10, pady=(0, 6))
        self._left_status_label = tk.Label(status_bar, textvariable=self.status_text, bg=PALETTE["panel_edge"], fg=PALETTE["muted"], font=(self.FONT_CODE, 7), anchor="w", padx=6, pady=2)
        self._left_status_label.pack(fill="x")

        # Session log (visible as collapsible section)
        self.log_body = tk.Frame(parent)
        self._refresh_log_view()

    def _build_center_panel(self, parent: tk.Frame) -> None:
        # --- WORKFLOW SCENE (top, takes most space) ---
        scene_card = tk.Frame(parent, bg=PALETTE["night_sky"], highlightthickness=5, highlightbackground=PALETTE["panel_edge"])
        scene_card.grid(row=0, column=0, sticky="nsew")
        scene_card.grid_columnconfigure(0, weight=1)
        scene_card.grid_rowconfigure(1, weight=1)
        tk.Label(scene_card, text="PIXELLAB WORLD FEED", bg=PALETTE["panel_edge"], fg=PALETTE["moon"], font=(self.FONT_CODE, 12, "bold"), anchor="w", padx=8, pady=4).grid(row=0, column=0, sticky="ew", padx=10, pady=(10, 4))
        self.stage = tk.Canvas(
            scene_card,
            height=200,
            bg=PALETTE["night_sky"],
            highlightthickness=4,
            highlightbackground=PALETTE["panel_edge"],
            relief="flat",
        )
        self.stage.grid(row=1, column=0, sticky="nsew", padx=10, pady=(0, 10))
        self.stage.bind("<Configure>", lambda _event: self._on_stage_configure())
        self.stage.bind("<Button-1>", self._on_stage_click)

        # --- ASSET LIBRARY (bottom, full width) ---
        library_panel = tk.Frame(parent, bg=PALETTE["panel_soft"], highlightthickness=3, highlightbackground=PALETTE["panel_edge"])
        library_panel.grid(row=1, column=0, sticky="nsew", pady=(8, 0))
        library_panel.grid_rowconfigure(2, weight=1)
        library_panel.grid_columnconfigure(0, weight=1)
        tk.Label(library_panel, text="ASSET LIBRARY", bg=PALETTE["panel_edge"], fg=PALETTE["moon"], font=(self.FONT_CODE, 10, "bold"), anchor="w", padx=6, pady=2).grid(row=0, column=0, sticky="ew", padx=10, pady=(8, 2))
        lib_header = tk.Frame(library_panel, bg=PALETTE["panel_soft"])
        lib_header.grid(row=1, column=0, sticky="ew", padx=10, pady=(0, 4))
        tk.Label(lib_header, textvariable=self.library_count_text, bg=PALETTE["panel_soft"], fg=PALETTE["muted"], font=(self.FONT_CODE, 8), anchor="w").pack(side="left")
        self.library_load_button = self._build_action_button(lib_header, "Load library", self._load_library, PALETTE["cyan"], padx=0)

        lib_content = tk.Frame(library_panel, bg=PALETTE["panel_soft"])
        lib_content.grid(row=2, column=0, sticky="nsew", padx=10, pady=(0, 8))
        lib_content.grid_columnconfigure(0, weight=1)
        lib_content.grid_columnconfigure(1, weight=0)
        lib_content.grid_rowconfigure(0, weight=1)

        self.library_listbox = tk.Listbox(
            lib_content,
            bg=PALETTE["night_sky"],
            fg=PALETTE["moon"],
            selectbackground=PALETTE["gold"],
            selectforeground=PALETTE["night_sky"],
            highlightthickness=2,
            highlightbackground=PALETTE["panel_edge"],
            relief="flat",
            activestyle="none",
            exportselection=False,
            font=(self.FONT_CODE, 9),
        )
        self.library_listbox.grid(row=0, column=0, sticky="nsew", padx=(0, 6))
        self.library_listbox.bind("<<ListboxSelect>>", self._on_library_select)

        self.library_preview_canvas = tk.Canvas(
            lib_content,
            width=140,
            height=100,
            bg=PALETTE["night_sky"],
            highlightthickness=2,
            highlightbackground=PALETTE["panel_edge"],
            relief="flat",
        )
        self.library_preview_canvas.grid(row=0, column=1, sticky="ns")
        self.library_preview_canvas.create_text(
            70, 50, text="Select asset\nto preview", fill=PALETTE["muted"],
            font=(self.FONT_CODE, 8), tags="placeholder", justify="center",
        )
        self.library_preview_image: tk.PhotoImage | None = None

        self._build_hidden_summary_cards(parent)
        self._clear_server_visuals("PixelLab server feed ceka na prvni ready asset.")

    def _build_hidden_summary_cards(self, parent: tk.Frame) -> None:
        hidden = tk.Frame(parent)
        self.summary_queue_card = tk.Frame(hidden, bg=PALETTE["panel_soft"], highlightthickness=3, highlightbackground=PALETTE["panel_edge"])
        self.summary_queue_title_label = tk.Label(hidden, bg=PALETTE["panel_soft"], fg=PALETTE["moon"])
        self.summary_bridge_activity_label = tk.Label(hidden, bg=PALETTE["panel_soft"], fg=PALETTE["muted"])
        self.summary_asset_card = tk.Frame(hidden, bg=PALETTE["panel_soft"], highlightthickness=3, highlightbackground=PALETTE["panel_edge"])
        self.summary_asset_title_label = tk.Label(hidden, bg=PALETTE["panel_soft"], fg=PALETTE["moon"])
        self.summary_asset_source_label = tk.Label(hidden, bg=PALETTE["panel_soft"], fg=PALETTE["muted"])
        self.summary_asset_activity_label = tk.Label(hidden, bg=PALETTE["panel_soft"], fg=PALETTE["muted"])

    def _on_stage_configure(self) -> None:
        if self.current_stage_image is not None and self.current_preview_image is not None:
            title = self.active_visual_title or "PixelLab asset"
            subtitle = self.active_visual_subtitle or "Server render feed"
            canvas_width, canvas_height = self._stage_dimensions()
            if self.active_visual_job_type == "tileset":
                self._render_tileset_stage_visual(self.current_preview_image, title, subtitle, canvas_width, canvas_height)
            else:
                self._render_character_stage_visual(self.current_preview_image, title, subtitle, canvas_width, canvas_height)
        else:
            self._draw_scene()

    def _draw_scene(self) -> None:
        canvas = self.stage
        canvas.delete("all")
        self.scene_node_regions = {}
        cw = canvas.winfo_width() or int(canvas.cget("width") or 0) or 920
        ch = canvas.winfo_height() or int(canvas.cget("height") or 0) or 300

        canvas.create_rectangle(0, 0, cw, ch, fill=PALETTE["night_sky"], outline="")

        # Subtle grid pattern
        grid_color = PALETTE.get("glow_cyan", "#1A3040")
        for gx in range(0, cw, 40):
            canvas.create_line(gx, 0, gx, ch, fill=grid_color, width=1)
        for gy in range(0, ch, 40):
            canvas.create_line(0, gy, cw, gy, fill=grid_color, width=1)

        # Workflow nodes definition (relative positions 0-1)
        workflow = [
            {"key": "entry", "label": "INPUT", "sub": "Chat / Prompt", "rx": 0.07, "ry": 0.5, "color": PALETTE["gold"], "glow": PALETTE.get("glow_gold", "#302818")},
            {"key": "memory", "label": "MEMORY", "sub": "Kontext", "rx": 0.22, "ry": 0.28, "color": PALETTE["leaf"], "glow": PALETTE.get("glow_leaf", "#1A2A1A")},
            {"key": "flow", "label": "ROZUM", "sub": "Orchestrace", "rx": 0.38, "ry": 0.5, "color": PALETTE["cyan"], "glow": PALETTE.get("glow_cyan", "#1A3040")},
            {"key": "tools", "label": "NASTROJE", "sub": "Edit / Term", "rx": 0.38, "ry": 0.82, "color": PALETTE["lavender"], "glow": "#1E1830"},
            {"key": "guardian", "label": "GUARDIAN", "sub": "Validace", "rx": 0.58, "ry": 0.28, "color": PALETTE["rose"], "glow": PALETTE.get("glow_rose", "#2A1818")},
            {"key": "workspace", "label": "WORKSPACE", "sub": "Soubory", "rx": 0.58, "ry": 0.78, "color": PALETTE["leaf"], "glow": PALETTE.get("glow_leaf", "#1A2A1A")},
            {"key": "pixel", "label": "PIXELLAB", "sub": "Assets", "rx": 0.78, "ry": 0.5, "color": PALETTE["cyan"], "glow": PALETTE.get("glow_cyan", "#1A3040")},
            {"key": "output", "label": "OUTPUT", "sub": "Odpoved", "rx": 0.93, "ry": 0.5, "color": PALETTE["gold"], "glow": PALETTE.get("glow_gold", "#302818")},
        ]

        # Compute node positions
        node_w, node_h = 110, 50
        positions: dict[str, tuple[int, int]] = {}
        for node in workflow:
            nx = int(node["rx"] * cw)
            ny = int(node["ry"] * ch)
            positions[node["key"]] = (nx, ny)

        # Draw edges with glow
        edges = [
            ("entry", "memory"), ("entry", "flow"),
            ("memory", "flow"), ("flow", "tools"),
            ("flow", "guardian"), ("guardian", "workspace"),
            ("guardian", "pixel"), ("tools", "workspace"),
            ("workspace", "pixel"), ("pixel", "output"),
            ("flow", "workspace"),
        ]
        for start_key, end_key in edges:
            if start_key not in positions or end_key not in positions:
                continue
            sx, sy = positions[start_key]
            ex, ey = positions[end_key]
            # Outer glow line
            canvas.create_line(sx, sy, ex, ey, fill=PALETTE["panel_edge"], width=4, smooth=True)
            # Inner bright line
            canvas.create_line(sx, sy, ex, ey, fill=PALETTE["muted"], width=1, smooth=True)
            # Arrow head
            dx, dy = ex - sx, ey - sy
            dist = math.sqrt(dx * dx + dy * dy) or 1
            ux, uy = dx / dist, dy / dist
            ax = ex - ux * (node_w // 2 + 4)
            ay = ey - uy * (node_h // 2 + 4)
            px, py = -uy * 5, ux * 5
            canvas.create_polygon(
                ax + ux * 10, ay + uy * 10,
                ax + px, ay + py,
                ax - px, ay - py,
                fill=PALETTE["muted"], outline="",
            )

        # Draw nodes with glow halos
        for node in workflow:
            nx, ny = positions[node["key"]]
            x1, y1 = nx - node_w // 2, ny - node_h // 2
            x2, y2 = nx + node_w // 2, ny + node_h // 2
            self.scene_node_regions[node["key"]] = (x1, y1, x2, y2)

            # Outer glow halo
            for offset in (8, 5, 3):
                canvas.create_rectangle(
                    x1 - offset, y1 - offset, x2 + offset, y2 + offset,
                    fill="", outline=node["glow"], width=2,
                )

            # Node body
            canvas.create_rectangle(x1, y1, x2, y2, fill=PALETTE["night_sky"], outline=node["color"], width=2)

            # Top accent bar
            canvas.create_rectangle(x1 + 1, y1 + 1, x2 - 1, y1 + 14, fill=node["color"], outline="")

            # Label text
            canvas.create_text(
                nx, y1 + 7,
                text=node["label"],
                fill=PALETTE["night_sky"],
                font=(self.FONT_CODE, 8, "bold"),
            )
            # Subtitle
            canvas.create_text(
                nx, ny + 8,
                text=node["sub"],
                fill=node["color"],
                font=(self.FONT_CODE, 7),
            )

        # Title overlay
        canvas.create_rectangle(12, 12, cw - 12, ch - 12, outline=PALETTE["panel_edge"], width=2)
        # Pulse dot (animated via _animate_workflow_pulse)
        pulse_x, pulse_y = positions.get("flow", (cw // 2, ch // 2))
        canvas.create_oval(
            pulse_x - 4, pulse_y - node_h // 2 - 12,
            pulse_x + 4, pulse_y - node_h // 2 - 4,
            fill=PALETTE["cyan"], outline=PALETTE["cyan"], tags="workflow_pulse",
        )
        if not getattr(self, "_workflow_pulse_active", False):
            self._workflow_pulse_active = True
            self._animate_workflow_pulse()

    def _animate_workflow_pulse(self) -> None:
        if not hasattr(self, "stage") or self.current_stage_image is not None:
            self._workflow_pulse_active = False
            return
        canvas = self.stage
        pulse_items = canvas.find_withtag("workflow_pulse")
        if not pulse_items:
            self._workflow_pulse_active = False
            return
        step = getattr(self, "_workflow_pulse_step", 0)
        self._workflow_pulse_step = (step + 1) % 30
        # Oscillate opacity via color blend
        t = abs((step % 30) - 15) / 15.0
        color = self._blend_color(PALETTE["night_sky"], PALETTE["cyan"], 0.3 + 0.7 * t)
        for item in pulse_items:
            canvas.itemconfigure(item, fill=color, outline=color)
        try:
            self.root.after(80, self._animate_workflow_pulse)
        except (AttributeError, RuntimeError, tk.TclError):
            self._workflow_pulse_active = False

    def _scene_node_at(self, x: int, y: int) -> str | None:
        for node_key, (x1, y1, x2, y2) in self.scene_node_regions.items():
            if x1 <= x <= x2 and y1 <= y <= y2:
                return node_key
        return None

    def _focus_scene_node(self, node_key: str) -> None:
        node = find_node(node_key)
        self.selected_node.set(node.title)
        self.status_text.set(node.subtitle)
        self._append_log(f"15:07  Focus moved to {node.title}")

    def _on_stage_click(self, event: tk.Event) -> None:
        node_key = self._scene_node_at(int(event.x), int(event.y))
        if node_key is None:
            return
        self._focus_scene_node(node_key)

    def _append_log(self, line: str) -> None:
        self.log_lines.insert(0, line)
        self.log_lines = self.log_lines[:8]
        self._write_external_log_line(line)
        self._refresh_log_view()

    def _safe_append_log(self, line: str) -> None:
        try:
            self._append_log(line)
        except (AttributeError, OSError, RuntimeError, tk.TclError):
            return

    def _write_external_log_line(self, line: str) -> None:
        log_path = getattr(self, "external_log_path", None)
        if not isinstance(log_path, Path):
            return
        try:
            log_path.parent.mkdir(parents=True, exist_ok=True)
            with log_path.open("a", encoding="utf-8") as handle:
                handle.write(f"{line}\n")
        except OSError:
            return

    def _write_fault_log_line(self, line: str) -> None:
        handle = getattr(self, "fault_log_handle", None)
        if handle is None:
            return
        try:
            handle.write(f"{line}\n")
            handle.flush()
        except OSError:
            return

    def _ui_runtime_state_summary(self) -> str:
        root_exists: str
        winfo_exists = getattr(getattr(self, "root", None), "winfo_exists", None)
        if callable(winfo_exists):
            try:
                root_exists = "yes" if bool(winfo_exists()) else "no"
            except (AttributeError, RuntimeError, tk.TclError):
                root_exists = "unknown"
        else:
            root_exists = "unknown"

        pending_callbacks: list[str] = []
        if getattr(self, "ui_callback_after_id", None) is not None:
            pending_callbacks.append("ui")
        if getattr(self, "poll_debounce_after_id", None) is not None:
            pending_callbacks.append("poll")
        if getattr(self, "auto_poll_after_id", None) is not None:
            pending_callbacks.append("auto")
        if getattr(self, "bootstrap_poll_after_id", None) is not None:
            pending_callbacks.append("bootstrap")

        pending_text = ",".join(pending_callbacks) if pending_callbacks else "none"
        return (
            f"close_requested={bool(getattr(self, 'close_requested', False))}, "
            f"root_exists={root_exists}, pending={pending_text}"
        )

    def _load_ui_preferences(self) -> None:
        settings = load_ui_settings()
        self.auto_poll_enabled.set(bool(settings["auto_poll_enabled"]))
        self.auto_poll_seconds.set(int(settings["auto_poll_seconds"]))
        self.asset_history_filter.set(str(settings["asset_history_filter"]))
        self.server_style_preset.set(normalize_server_style_preset(settings.get("server_style_preset", DEFAULT_SERVER_STYLE_PRESET)))
        self.server_style_preset_text.set(server_style_preset_label(self.server_style_preset.get()))

    def _persist_ui_preferences(self) -> None:
        settings = {
            "auto_poll_enabled": self.auto_poll_enabled.get(),
            "auto_poll_seconds": self.auto_poll_seconds.get(),
            "asset_history_filter": self.asset_history_filter.get(),
            "server_style_preset": self.server_style_preset.get(),
        }
        try:
            save_ui_settings(settings)
        except OSError as error:
            error_text = str(error)
            if error_text != self.ui_settings_save_error:
                self.ui_settings_save_error = error_text
                self.status_text.set("Nepodarilo se ulozit UI nastaveni")
                self._append_log(f"15:06  UI settings save failed: {error_text}")
            return
        self.ui_settings_save_error = ""

    def _refresh_log_view(self) -> None:
        for child in self.log_body.winfo_children():
            child.destroy()
        for line in self.log_lines[:4]:
            tk.Label(self.log_body, text=line, bg=PALETTE["panel_soft"], fg=PALETTE["muted"], font=(self.FONT_CODE, 9), anchor="w").pack(fill="x", pady=1)

    def _load_library(self) -> None:
        if self.library_loading:
            return
        self.library_loading = True
        self._set_asset_button_state(self.library_load_button, False)
        self.library_count_text.set("Loading...")
        self._append_log("15:08  Asset library refresh started")
        worker = threading.Thread(target=self._load_library_worker, daemon=True)
        worker.start()

    def _load_library_worker(self) -> None:
        items: list[dict[str, str]] = []
        try:
            if callable(self.bridge.tool_bindings.get("list_characters")):
                result = self.bridge.tool_bindings["list_characters"]()
                items.extend(self._parse_library_listing(result, "character"))
            if callable(self.bridge.tool_bindings.get("list_topdown_tilesets")):
                result = self.bridge.tool_bindings["list_topdown_tilesets"]()
                items.extend(self._parse_library_listing(result, "tileset"))
        except (OSError, RuntimeError, ValueError, urlerror.URLError):
            pass
        self._dispatch_to_ui(lambda: self._apply_library_result(items))

    def _parse_library_listing(self, result: object, asset_type: str) -> list[dict[str, str]]:
        if not isinstance(result, dict):
            return []
        raw_items = result.get("items")
        if not isinstance(raw_items, list):
            return []
        parsed: list[dict[str, str]] = []
        for item in raw_items:
            if not isinstance(item, dict):
                continue
            remote_id = str(item.get("remote_id") or "").strip()
            if not remote_id:
                continue
            label = str(item.get("label") or item.get("prompt") or remote_id).strip()
            status = str(item.get("status") or "unknown").strip().lower()
            parsed.append({"type": asset_type, "id": remote_id, "label": label, "status": status})
        return parsed

    def _apply_library_result(self, items: list[dict[str, str]]) -> None:
        self.library_loading = False
        self._set_asset_button_state(self.library_load_button, True)
        self.library_items = items
        char_count = sum(1 for it in items if it["type"] == "character")
        tile_count = sum(1 for it in items if it["type"] == "tileset")
        self.library_count_text.set(f"Characters: {char_count}  Tilesets: {tile_count}")
        self._refresh_library_listbox()
        self._append_log(f"15:08  Library loaded: {char_count} characters, {tile_count} tilesets")

    def _refresh_library_listbox(self) -> None:
        lb = self.library_listbox
        lb.delete(0, "end")
        for item in self.library_items:
            prefix = "\U0001f9d1" if item["type"] == "character" else "\U0001f5fa"
            label = item["label"]
            if len(label) > 56:
                label = label[:53] + "..."
            status_mark = "\u2705" if item["status"] in {"ready", "done", "completed"} else "\u23f3"
            lb.insert("end", f" {prefix} {status_mark} {label}")
            index = lb.size() - 1
            tone = self._tracked_job_tone(item["status"])
            color = self.STATUS_TONE_COLORS[tone]
            try:
                lb.itemconfig(index, foreground=color, selectforeground=PALETTE["night_sky"])
            except (AttributeError, tk.TclError):
                pass

    def _on_library_select(self, _event: object) -> None:
        selection = self.library_listbox.curselection()
        if not selection:
            return
        index = int(selection[0])
        if index < 0 or index >= len(self.library_items):
            return
        item = self.library_items[index]
        remote_id = item["id"]
        asset_type = item["type"]
        self.active_visual_title = item["label"][:48]
        self.active_visual_subtitle = f"Library {asset_type} | {remote_id[:12]}"
        self.active_visual_job_type = asset_type
        if asset_type == "character" and callable(self.bridge.tool_bindings.get("get_character")):
            self._load_library_asset_detail("get_character", {"character_id": remote_id, "include_preview": True}, asset_type)
        elif asset_type == "tileset" and callable(self.bridge.tool_bindings.get("get_topdown_tileset")):
            self._load_library_asset_detail("get_topdown_tileset", {"tileset_id": remote_id}, asset_type)
        else:
            self.status_text.set(f"Selected: {item['label'][:48]}")

    def _load_library_asset_detail(self, tool_name: str, args: dict[str, object], asset_type: str) -> None:
        self.status_text.set(f"Loading {asset_type} detail...")
        worker = threading.Thread(target=self._load_library_detail_worker, args=(tool_name, args, asset_type), daemon=True)
        worker.start()

    def _load_library_detail_worker(self, tool_name: str, args: dict[str, object], asset_type: str) -> None:
        try:
            result = self.bridge.tool_bindings[tool_name](**args)
            meta = self.bridge._extract_asset_metadata(result)
        except (OSError, RuntimeError, ValueError, urlerror.URLError, TimeoutError):
            meta = {"preview_url": "", "download_url": "", "asset_name": ""}
        self._dispatch_to_ui(lambda: self._apply_library_detail(meta, asset_type))

    def _apply_library_detail(self, meta: dict[str, str], asset_type: str) -> None:
        preview = meta.get("preview_url") or meta.get("download_url") or ""
        download = meta.get("download_url") or ""
        if preview:
            self.preview_asset_url = preview
            self.download_asset_url = download
            self._refresh_asset_action_buttons()
            self.asset_status_text.set(f"Library: {meta.get('asset_name', asset_type)[:40]}")
            if should_reload_preview(self.loaded_preview_url, preview):
                self._start_preview_load(preview)
            self._start_library_inline_preview(preview)
        else:
            self.status_text.set(f"Asset {asset_type}: no preview URL available")
            self._clear_library_preview("No preview available")

    def _start_library_inline_preview(self, url: str) -> None:
        worker = threading.Thread(target=self._load_library_preview_worker, args=(url,), daemon=True)
        worker.start()

    def _load_library_preview_worker(self, url: str) -> None:
        try:
            cached_path, _created = ensure_asset_cached(url, timeout=3, auth_headers=self._auth_for_url(url))
        except (OSError, ValueError, urlerror.URLError):
            cached_path = None
        self._dispatch_to_ui(lambda: self._apply_library_inline_preview(cached_path))

    def _apply_library_inline_preview(self, cached_path: "Path | None") -> None:
        canvas = getattr(self, "library_preview_canvas", None)
        if canvas is None:
            return
        if cached_path is None:
            self._clear_library_preview("Preview failed")
            return
        try:
            image = tk.PhotoImage(file=str(cached_path))
        except (RuntimeError, tk.TclError):
            self._clear_library_preview("Unsupported format")
            return
        cw = canvas.winfo_width() or 200
        ch = int(canvas.cget("height"))
        scaled = self._scale_photoimage_to_bounds(image, cw - 8, ch - 8, upscale_limit=8)
        self.library_preview_image = scaled
        canvas.delete("all")
        canvas.create_rectangle(0, 0, cw, ch, fill=PALETTE["night_sky"], outline="")
        canvas.create_image(cw // 2, ch // 2, image=scaled)

    def _clear_library_preview(self, label: str) -> None:
        canvas = getattr(self, "library_preview_canvas", None)
        if canvas is None:
            return
        cw = canvas.winfo_width() or 200
        ch = int(canvas.cget("height"))
        self.library_preview_image = None
        canvas.delete("all")
        canvas.create_rectangle(0, 0, cw, ch, fill=PALETTE["night_sky"], outline="")
        canvas.create_text(cw // 2, ch // 2, text=label, fill=PALETTE["muted"], font=(self.FONT_CODE, 9))

    def _blend_color(self, start: str, end: str, amount: float) -> str:
        start_rgb = tuple(int(start[index:index + 2], 16) for index in (1, 3, 5))
        end_rgb = tuple(int(end[index:index + 2], 16) for index in (1, 3, 5))
        blended = tuple(int(round(base + (target - base) * amount)) for base, target in zip(start_rgb, end_rgb))
        return f"#{blended[0]:02X}{blended[1]:02X}{blended[2]:02X}"

    def _apply_button_palette(self, button: tk.Button, enabled: bool, hovered: bool = False) -> None:
        accent = getattr(button, "accent_color", PALETTE["panel_edge"])
        hover_color = getattr(button, "hover_color", accent)
        button.configure(
            bg=hover_color if enabled and hovered else accent if enabled else PALETTE["panel_edge"],
            fg=PALETTE["night_sky"] if enabled else PALETTE["muted"],
            activebackground=hover_color if enabled else PALETTE["panel_edge"],
            activeforeground=PALETTE["night_sky"] if enabled else PALETTE["muted"],
            disabledforeground=PALETTE["muted"],
            cursor="hand2" if enabled else "arrow",
        )

    def _on_button_hover(self, button: tk.Button, hovered: bool) -> None:
        if str(button.cget("state")) == "disabled":
            return
        self._apply_button_palette(button, True, hovered)

    def _build_action_button(self, parent: tk.Widget, text: str, command: object, accent: str, *, padx: int | tuple[int, int] = (0, 10), state: str = "normal") -> tk.Button:
        button = tk.Button(
            parent,
            text=text,
            command=command,
            bg=accent,
            fg=PALETTE["night_sky"],
            activebackground=accent,
            activeforeground=PALETTE["night_sky"],
            font=(self.FONT_CODE, 10, "bold"),
            relief="raised",
            bd=3,
            highlightthickness=2,
            highlightbackground=PALETTE["panel_edge"],
            padx=12,
            pady=6,
        )
        button.accent_color = accent
        button.hover_color = self._blend_color(accent, PALETTE["moon"], 0.16)
        button.bind("<Enter>", lambda _event, target=button: self._on_button_hover(target, True))
        button.bind("<Leave>", lambda _event, target=button: self._on_button_hover(target, False))
        button.pack(side="left", padx=padx)
        self._set_asset_button_state(button, state != "disabled")
        return button

    def run(self) -> None:
        session_id = getattr(self, "runtime_session_id", "unknown")
        self._safe_append_log(f"15:06  UI mainloop starting | {self._ui_runtime_state_summary()} | session={session_id}")
        try:
            self.root.mainloop()
        except tk.TclError:
            self._safe_append_log(f"15:06  UI mainloop aborted with TclError | {self._ui_runtime_state_summary()}")
            if not getattr(self, "close_requested", False):
                raise
        else:
            if getattr(self, "close_requested", False):
                self._safe_append_log(f"15:06  UI mainloop exited after close request | {self._ui_runtime_state_summary()}")
            else:
                self._safe_append_log(f"15:06  UI mainloop exited without close request | {self._ui_runtime_state_summary()}")
        finally:
            self._cancel_scheduled_callbacks()
            self._close_fault_handler()

    def _build_right_panel(self, parent: tk.Frame) -> None:
        right_canvas = tk.Canvas(parent, bg=PALETTE["panel"], highlightthickness=0, bd=0)
        right_scrollbar = tk.Scrollbar(parent, orient="vertical", command=right_canvas.yview)
        inner = tk.Frame(right_canvas, bg=PALETTE["panel"])
        inner.bind("<Configure>", lambda _e: right_canvas.configure(scrollregion=right_canvas.bbox("all")))
        right_canvas.create_window((0, 0), window=inner, anchor="nw", tags="inner_window")

        def _sync_inner_width(_event: object = None) -> None:
            right_canvas.itemconfigure("inner_window", width=right_canvas.winfo_width())
        right_canvas.bind("<Configure>", _sync_inner_width)
        right_canvas.configure(yscrollcommand=right_scrollbar.set)
        right_scrollbar.pack(side="right", fill="y")
        right_canvas.pack(side="left", fill="both", expand=True)

        def _on_right_mousewheel(event: object) -> None:
            right_canvas.yview_scroll(int(-1 * (event.delta / 120)), "units")
        right_canvas.bind("<Enter>", lambda _e: right_canvas.bind_all("<MouseWheel>", _on_right_mousewheel))
        right_canvas.bind("<Leave>", lambda _e: right_canvas.unbind_all("<MouseWheel>"))

        self._panel_title(inner, "ASSET MANAGER")
        self._build_asset_preview(inner)

    def _build_pixellab_form(self, parent: tk.Frame) -> None:
        form = tk.Frame(parent, bg=PALETTE["panel_soft"], highlightthickness=3, highlightbackground=PALETTE["panel_edge"])
        form.pack(fill="x", padx=10, pady=4)
        self._section_caption(form, "GENERATE", PALETTE["cyan"])

        # Style presets — horizontal row
        preset_row = tk.Frame(form, bg=PALETTE["panel_soft"])
        preset_row.pack(fill="x", padx=8, pady=(0, 4))
        for preset_key in ("graph_workbench", "dark_network_map", "control_room_lattice"):
            tk.Radiobutton(
                preset_row,
                text=str(SERVER_STYLE_PRESETS[preset_key]["label"]),
                value=preset_key,
                variable=self.server_style_preset,
                command=self._on_server_style_preset_changed,
                bg=PALETTE["panel_soft"],
                fg=PALETTE["muted"],
                activebackground=PALETTE["panel_soft"],
                activeforeground=PALETTE["text"],
                selectcolor=PALETTE["night_sky"],
                font=(self.FONT_CODE, 8),
                anchor="w",
            ).pack(side="left", padx=(0, 4))

        for label_text, var in [("Character prompt", self.character_prompt), ("Tileset lower", self.tileset_lower), ("Tileset upper", self.tileset_upper)]:
            tk.Label(form, text=label_text, bg=PALETTE["panel_soft"], fg=PALETTE["muted"], font=(self.FONT_CODE, 9), anchor="w").pack(fill="x", padx=8)
            tk.Entry(form, textvariable=var, bg=PALETTE["fog"], fg=PALETTE["text"], insertbackground=PALETTE["cyan"], relief="flat", highlightthickness=2, highlightbackground=PALETTE["panel_edge"], highlightcolor=PALETTE["cyan"], font=(self.FONT_CODE, 9)).pack(fill="x", padx=8, pady=(1, 4), ipady=4)

        # All action buttons on one row
        actions = tk.Frame(form, bg=PALETTE["panel_soft"])
        actions.pack(fill="x", padx=8, pady=(2, 2))
        self.queue_character_button = self._build_action_button(actions, "Queue char", self._queue_character, PALETTE["leaf"])
        self.queue_tileset_button = self._build_action_button(actions, "Queue tile", self._queue_tileset, PALETTE["gold"])
        self.poll_jobs_button = self._build_action_button(actions, "Poll", self._poll_jobs, PALETTE["cyan"], padx=0)

        # Auto poll inline
        poll_row = tk.Frame(form, bg=PALETTE["panel_soft"])
        poll_row.pack(fill="x", padx=8, pady=(0, 3))
        tk.Checkbutton(
            poll_row, text="Auto poll", variable=self.auto_poll_enabled,
            command=self._on_auto_poll_toggle, bg=PALETTE["panel_soft"], fg=PALETTE["moon"],
            activebackground=PALETTE["panel_soft"], activeforeground=PALETTE["text"],
            selectcolor=PALETTE["night_sky"], font=(self.FONT_CODE, 8), anchor="w",
        ).pack(side="left")
        self.auto_poll_spinbox = tk.Spinbox(
            poll_row, from_=1, to=30, width=3, textvariable=self.auto_poll_seconds,
            command=self._on_auto_poll_interval_changed, bg=PALETTE["fog"], fg=PALETTE["text"],
            buttonbackground=PALETTE["panel_edge"], insertbackground=PALETTE["cyan"],
            relief="flat", justify="center", highlightthickness=2,
            highlightbackground=PALETTE["panel_edge"], highlightcolor=PALETTE["gold"],
            font=(self.FONT_CODE, 8),
        )
        self.auto_poll_spinbox.pack(side="left", padx=(6, 2))
        self.auto_poll_spinbox.bind("<FocusOut>", self._on_auto_poll_interval_changed)
        self.auto_poll_spinbox.bind("<Return>", self._on_auto_poll_interval_changed)
        tk.Label(poll_row, text="sec", bg=PALETTE["panel_soft"], fg=PALETTE["muted"], font=(self.FONT_CODE, 8)).pack(side="left")

        # Bridge activity indicator (visible under form)
        self.bridge_activity_label = tk.Label(form, textvariable=self.bridge_activity_text, bg=PALETTE["panel_soft"], fg=PALETTE["muted"], font=(self.FONT_CODE, 8), anchor="w")
        self.bridge_activity_label.pack(fill="x", padx=8, pady=(0, 5))

    def _build_asset_preview(self, parent: tk.Frame) -> None:
        preview = tk.Frame(parent, bg=PALETTE["panel_soft"], highlightthickness=3, highlightbackground=PALETTE["panel_edge"])
        preview.pack(fill="x", padx=14, pady=6)
        self._section_caption(preview, "ASSET PREVIEW", PALETTE["rose"])

        self.preview_canvas = tk.Canvas(
            preview,
            width=280,
            height=160,
            bg=PALETTE["sky_glow"],
            highlightthickness=2,
            highlightbackground=PALETTE["panel_edge"],
        )
        self.preview_canvas.pack(fill="x", padx=10, pady=(2, 6))
        self.preview_canvas.create_text(140, 80, text="No preview yet", fill=PALETTE["muted"], font=(self.FONT_CODE, 11, "bold"), tags="placeholder")

        tk.Label(preview, textvariable=self.asset_status_text, bg=PALETTE["panel_soft"], fg=PALETTE["text"], font=(self.FONT_CODE, 9, "bold"), anchor="w", justify="left", wraplength=280).pack(fill="x", padx=10, pady=(0, 2))
        self.asset_activity_label = tk.Label(preview, textvariable=self.asset_activity_text, bg=PALETTE["panel_soft"], fg=PALETTE["muted"], font=(self.FONT_CODE, 8), anchor="w", justify="left", wraplength=280)
        self.asset_activity_label.pack(fill="x", padx=10, pady=(0, 4))
        self.preview_asset_source_label = tk.Label(preview, textvariable=self.asset_source_badge_text, bg=PALETTE["panel_soft"], fg=PALETTE["muted"], font=(self.FONT_CODE, 7, "bold"), anchor="w")
        self.preview_asset_source_label.pack(fill="x", padx=10, pady=(0, 2))
        tk.Label(preview, textvariable=self.asset_cache_text, bg=PALETTE["panel_soft"], fg=PALETTE["muted"], font=(self.FONT_CODE, 7), anchor="w").pack(fill="x", padx=10, pady=(0, 4))

        # Actions row: Open + Save
        actions = tk.Frame(preview, bg=PALETTE["panel_soft"])
        actions.pack(fill="x", padx=10, pady=(0, 4))
        self.preview_link_button = self._build_action_button(actions, "Open preview", lambda: self._open_asset_url(self.preview_asset_url, "preview"), PALETTE["rose"], state="disabled")
        self.save_preview_button = self._build_action_button(actions, "Save preview", lambda: self._save_cached_asset_as("preview"), PALETTE["leaf"], state="disabled")
        self.download_link_button = self._build_action_button(actions, "Open download", lambda: self._open_asset_url(self.download_asset_url, "download"), PALETTE["gold"], padx=0, state="disabled")

        actions2 = tk.Frame(preview, bg=PALETTE["panel_soft"])
        actions2.pack(fill="x", padx=10, pady=(0, 4))
        self.save_download_button = self._build_action_button(actions2, "Save download", lambda: self._save_cached_asset_as("download"), PALETTE["gold"], state="disabled")
        self.refresh_cache_button = self._build_action_button(actions2, "Refresh cache", self._refresh_cached_assets, PALETTE["cyan"], padx=0, state="disabled")

        # Recent assets
        tk.Label(preview, text="RECENT ASSETS", bg=PALETTE["panel_edge"], fg=PALETTE["moon"], font=(self.FONT_CODE, 8, "bold"), anchor="w", padx=4, pady=1).pack(fill="x", padx=10, pady=(4, 4))
        filter_row = tk.Frame(preview, bg=PALETTE["panel_soft"])
        filter_row.pack(fill="x", padx=10, pady=(0, 4))
        for value, label in (("all", "All"), ("character", "Characters"), ("tileset", "Tilesets")):
            tk.Radiobutton(
                filter_row,
                textvariable=self.asset_history_filter_labels[value],
                value=value,
                variable=self.asset_history_filter,
                command=self._on_asset_history_filter_changed,
                bg=PALETTE["panel_soft"],
                fg=PALETTE["muted"],
                activebackground=PALETTE["panel_soft"],
                activeforeground=PALETTE["text"],
                selectcolor=PALETTE["night_sky"],
                font=(self.FONT_CODE, 8),
                anchor="w",
            ).pack(side="left", padx=(0, 8))
        self.asset_history_listbox = tk.Listbox(
            preview,
            height=3,
            bg=PALETTE["night_sky"],
            fg=PALETTE["moon"],
            selectbackground=PALETTE["leaf"],
            selectforeground=PALETTE["text"],
            highlightthickness=2,
            highlightbackground=PALETTE["panel_edge"],
            relief="flat",
            activestyle="none",
            exportselection=False,
            font=(self.FONT_CODE, 8),
        )
        self.asset_history_listbox.pack(fill="x", padx=10, pady=(0, 8))
        self.asset_history_listbox.bind("<<ListboxSelect>>", self._on_asset_history_select)

    def _queue_character(self) -> None:
        request_id = self._begin_bridge_action("queue_character")
        prompt = compose_character_prompt(self.character_prompt.get(), self.server_style_preset.get())
        self.bridge_activity_error = ""
        self.status_text.set("Queueing character...")
        worker = threading.Thread(target=self._queue_character_worker, args=(prompt, request_id), daemon=True)
        worker.start()

    def _queue_character_worker(self, prompt: str, request_id: int) -> None:
        try:
            job = self.bridge.submit_character(prompt)
            error_text = ""
        except (OSError, RuntimeError, ValueError, urlerror.URLError) as error:
            job = None
            error_text = str(error)
        self._dispatch_to_ui(lambda: self._apply_queue_character_result(job, error_text, request_id))

    def _apply_queue_character_result(self, job: object | None, error_text: str, request_id: int) -> None:
        if not self._finish_bridge_action("queue_character", request_id):
            return
        if job is None:
            self.bridge_activity_error = error_text or "Character queue failed"
            self._refresh_bridge_activity_text()
            self.status_text.set(f"PixelLab error: {self.bridge_activity_error}")
            self._append_log(f"15:01  Character queue failed: {self.bridge_activity_error}")
            return
        self.bridge_activity_error = ""
        self.selected_node.set("PixelLab paseka")
        self.status_text.set(f"Character queued: {job.status} ({job.source})")
        self._append_log(f"15:01  Character queued: {job.prompt}")
        self._refresh_job_summary()
        self._refresh_asset_preview()
        if not self.auto_poll_enabled.get():
            self.auto_poll_enabled.set(True)
        if self.bootstrap_visual_generation_requested:
            self._schedule_bootstrap_poll(1200)
        self._schedule_auto_poll(800)

    def _queue_tileset(self) -> None:
        request_id = self._begin_bridge_action("queue_tileset")
        lower, upper = compose_tileset_prompts(self.tileset_lower.get(), self.tileset_upper.get(), self.server_style_preset.get())
        self.bridge_activity_error = ""
        self.status_text.set("Queueing tileset...")
        worker = threading.Thread(target=self._queue_tileset_worker, args=(lower, upper, request_id), daemon=True)
        worker.start()

    def _queue_tileset_worker(self, lower: str, upper: str, request_id: int) -> None:
        try:
            job = self.bridge.submit_tileset(lower, upper)
            error_text = ""
        except (OSError, RuntimeError, ValueError, urlerror.URLError) as error:
            job = None
            error_text = str(error)
        self._dispatch_to_ui(lambda: self._apply_queue_tileset_result(job, error_text, request_id))

    def _apply_queue_tileset_result(self, job: object | None, error_text: str, request_id: int) -> None:
        if not self._finish_bridge_action("queue_tileset", request_id):
            return
        if job is None:
            self.bridge_activity_error = error_text or "Tileset queue failed"
            self._refresh_bridge_activity_text()
            self.status_text.set(f"PixelLab error: {self.bridge_activity_error}")
            self._append_log(f"15:02  Tileset queue failed: {self.bridge_activity_error}")
            return
        self.bridge_activity_error = ""
        self.selected_node.set("PixelLab paseka")
        self.status_text.set(f"Tileset queued: {job.status} ({job.source})")
        self._append_log(f"15:02  Tileset queued: {job.prompt}")
        self._refresh_job_summary()
        self._refresh_asset_preview()
        if not self.auto_poll_enabled.get():
            self.auto_poll_enabled.set(True)
        if self.bootstrap_visual_generation_requested:
            self._schedule_bootstrap_poll(1200)
        self._schedule_auto_poll(800)

    def _poll_jobs(self) -> None:
        self.bridge_activity_error = ""
        if "poll_jobs" in self.bridge_action_in_progress:
            self.poll_follow_up_requested = True
            self.status_text.set("Current poll still runs, one follow-up refresh was queued")
            self._refresh_bridge_activity_text()
            return

        self._cancel_auto_poll()
        if self.poll_debounce_after_id is not None:
            self.root.after_cancel(self.poll_debounce_after_id)

        self.status_text.set("Polling live jobs shortly...")
        self.poll_debounce_after_id = self.root.after(250, self._start_poll_jobs_request)
        self._refresh_bridge_activity_text()

    def _on_auto_poll_toggle(self) -> None:
        self._persist_ui_preferences()
        if self.auto_poll_enabled.get():
            self.bridge_activity_error = ""
            self.status_text.set("Auto-poll enabled")
            self._schedule_auto_poll(500)
        else:
            self.bootstrap_visual_generation_requested = False
            self._cancel_bootstrap_poll()
            self._cancel_auto_poll()
            self.status_text.set("Auto-poll paused")
            self._refresh_bridge_activity_text()

    def _on_auto_poll_interval_changed(self, _event: object | None = None) -> None:
        normalized = normalize_poll_interval_seconds(self.auto_poll_seconds.get())
        self.auto_poll_seconds.set(normalized)
        self._persist_ui_preferences()
        if self.auto_poll_enabled.get():
            self._cancel_auto_poll()
            self.status_text.set(f"Auto-poll interval set to {normalized}s")
            self._schedule_auto_poll(normalized * 1000)
        else:
            self._refresh_bridge_activity_text()

    def _schedule_auto_poll(self, delay_ms: int = 3000) -> None:
        if not self.auto_poll_enabled.get():
            return
        if self.auto_poll_after_id is not None:
            return
        if "poll_jobs" in self.bridge_action_in_progress or self.poll_debounce_after_id is not None:
            return
        normalized_delay = max(250, delay_ms)
        self.auto_poll_after_id = self.root.after(normalized_delay, self._run_auto_poll)
        self._refresh_bridge_activity_text()

    def _bridge_supports_tool(self, tool_name: str) -> bool:
        bindings = getattr(getattr(self, "bridge", None), "tool_bindings", None)
        if not isinstance(bindings, dict):
            return False
        return callable(bindings.get(tool_name))

    def _maybe_bootstrap_server_visuals(self) -> None:
        if not getattr(getattr(self, "bridge", None), "has_live_tools", False):
            return
        if not self._live_automation_enabled():
            self.bootstrap_visual_generation_requested = False
            self._cancel_bootstrap_poll()
            return
        jobs = list(getattr(self.bridge, "list_jobs", lambda: [])())
        has_character_jobs = any(getattr(job, "job_type", "") == "character" for job in jobs)
        has_tileset_jobs = self._has_tileset_job(jobs)

        if self._has_ready_tileset_job(jobs):
            self.bootstrap_visual_generation_requested = False
            self._cancel_bootstrap_poll()
            return
        if has_tileset_jobs:
            self.bootstrap_visual_generation_requested = True
            self._schedule_bootstrap_poll(1200)
            return
        if self.bootstrap_visual_generation_requested:
            return

        queued_any = False
        self.bootstrap_visual_generation_requested = True
        self.status_text.set("Bootstrapping PixelLab visuals...")
        self._append_log("15:00  Bootstrapping initial PixelLab visuals")
        self._clear_server_visuals("PixelLab bootstrap bezi. UI si sam vyrabi prvni server scene.")

        if not has_character_jobs and self._bridge_supports_tool("create_character"):
            self._queue_character()
            queued_any = True
        if not has_tileset_jobs and self._bridge_supports_tool("create_topdown_tileset"):
            self._queue_tileset()
            queued_any = True

        if queued_any:
            self._schedule_bootstrap_poll(1200)
            return

        self.bootstrap_visual_generation_requested = False

    def _schedule_bootstrap_poll(self, delay_ms: int = 2500) -> None:
        if not self.bootstrap_visual_generation_requested or not self._live_automation_enabled():
            return
        if self.bootstrap_poll_after_id is not None:
            return
        if "poll_jobs" in self.bridge_action_in_progress or self.poll_debounce_after_id is not None:
            return
        normalized_delay = max(500, delay_ms)
        self.bootstrap_poll_after_id = self.root.after(normalized_delay, self._run_bootstrap_poll)

    def _cancel_bootstrap_poll(self) -> None:
        if self.bootstrap_poll_after_id is None:
            return
        self.root.after_cancel(self.bootstrap_poll_after_id)
        self.bootstrap_poll_after_id = None

    def _run_bootstrap_poll(self) -> None:
        self.bootstrap_poll_after_id = None
        if not self.bootstrap_visual_generation_requested or not self._live_automation_enabled():
            return
        self._poll_jobs()

    def _cancel_auto_poll(self) -> None:
        if self.auto_poll_after_id is None:
            return
        self.root.after_cancel(self.auto_poll_after_id)
        self.auto_poll_after_id = None
        self._refresh_bridge_activity_text()

    def _run_auto_poll(self) -> None:
        self.auto_poll_after_id = None
        if not self.auto_poll_enabled.get():
            self._refresh_bridge_activity_text()
            return
        self._poll_jobs()

    def _start_poll_jobs_request(self) -> None:
        self.poll_debounce_after_id = None
        request_id = self._begin_bridge_action("poll_jobs")
        self.bridge_activity_error = ""
        self.status_text.set("Polling live jobs...")
        worker = threading.Thread(target=self._poll_jobs_worker, args=(request_id,), daemon=True)
        worker.start()

    def _poll_jobs_worker(self, request_id: int) -> None:
        try:
            jobs = self.bridge.refresh_jobs()
            error_text = ""
        except (OSError, RuntimeError, ValueError, urlerror.URLError) as error:
            jobs = None
            error_text = str(error)
        self._dispatch_to_ui(lambda: self._apply_poll_jobs_result(jobs, error_text, request_id))

    def _apply_poll_jobs_result(self, jobs: list[object] | None, error_text: str, request_id: int) -> None:
        if not self._finish_bridge_action("poll_jobs", request_id):
            return
        rerun_requested = self.poll_follow_up_requested
        self.poll_follow_up_requested = False
        if jobs is None:
            self.bridge_activity_error = error_text or "Poll failed"
            self._refresh_bridge_activity_text()
            self.status_text.set(f"PixelLab poll failed: {self.bridge_activity_error}")
            self._append_log(f"15:03  Poll jobs failed: {self.bridge_activity_error}")
            if self.bootstrap_visual_generation_requested:
                self._schedule_bootstrap_poll(2500)
            if rerun_requested:
                self._poll_jobs()
            else:
                self._schedule_auto_poll()
            return
        self.bridge_activity_error = ""
        self.status_text.set(f"PixelLab poll complete: {len(jobs)} jobu")
        self._append_log(f"15:03  Poll jobs: {len(jobs)} tracked")
        self._refresh_job_summary()
        self._refresh_asset_preview()
        if not jobs and not self.bootstrap_visual_generation_requested:
            self._maybe_bootstrap_server_visuals()
        if self._has_ready_tileset_job(jobs):
            self.bootstrap_visual_generation_requested = False
            self._cancel_bootstrap_poll()
        elif not self.bootstrap_visual_generation_requested and not self._has_tileset_job(jobs):
            self._maybe_bootstrap_server_visuals()
        elif self.bootstrap_visual_generation_requested and self._live_automation_enabled():
            self._schedule_bootstrap_poll(2500)
        elif self._live_automation_enabled():
            self.bootstrap_visual_generation_requested = True
            self._schedule_bootstrap_poll(2500)
        if rerun_requested:
            self._poll_jobs()
        else:
            self._schedule_auto_poll()

    def _has_tileset_job(self, jobs: list[object]) -> bool:
        return any(getattr(job, "job_type", "") == "tileset" for job in jobs)

    def _has_ready_tileset_job(self, jobs: list[object]) -> bool:
        return any(
            getattr(job, "job_type", "") == "tileset"
            and str(getattr(job, "status", "")).strip().lower() == "ready"
            and (getattr(job, "preview_url", "") or getattr(job, "download_url", ""))
            for job in jobs
        )

    def _refresh_job_summary(self) -> None:
        jobs = self.bridge.list_jobs()
        if not jobs:
            self.job_summary_text.set("Zatim bez queued jobu")
            self._refresh_tracked_jobs([])
            return
        ready_count = sum(1 for job in jobs if str(getattr(job, "status", "")).strip().lower() == "ready")
        active_count = sum(
            1
            for job in jobs
            if str(getattr(job, "status", "")).strip().lower() in {"queued", "processing", "running", "pending"}
        )
        self.job_summary_text.set(f"Tracked: {len(jobs)} | Ready: {ready_count} | Active: {active_count}")
        self._refresh_tracked_jobs(jobs)

    def _refresh_tracked_jobs(self, jobs: list[object]) -> None:
        self.updating_tracked_jobs = True
        if hasattr(self, "tracked_job_listbox"):
            self.tracked_job_listbox.delete(0, tk.END)
        self.tracked_job_ids = [getattr(job, "job_id", "") for job in jobs]

        if hasattr(self, "tracked_job_listbox"):
            for index, job in enumerate(jobs):
                self.tracked_job_listbox.insert(tk.END, summarize_tracked_job_entry(job))
                self._apply_tracked_job_list_tone(index, str(getattr(job, "status", "")))

        if not jobs:
            self.tracked_job_id = ""
            self.tracked_job_detail_text.set("Vyber tracked job pro detail stavu, promptu a asset linku.")
            self.tracked_job_full_detail_text = "Vyber tracked job pro detail stavu, promptu a asset linku."
            self._refresh_tracked_job_action_buttons()
            self.updating_tracked_jobs = False
            return

        if self.tracked_job_id not in self.tracked_job_ids:
            self.tracked_job_id = self.tracked_job_ids[0]

        selected_index = self.tracked_job_ids.index(self.tracked_job_id)
        selected_job = jobs[selected_index]
        self.tracked_job_detail_text.set(build_tracked_job_detail(selected_job))
        self.tracked_job_full_detail_text = build_tracked_job_detail(selected_job, compact=False)
        self._refresh_tracked_job_action_buttons()

        if hasattr(self, "tracked_job_listbox"):
            self.tracked_job_listbox.selection_clear(0, tk.END)
            self.tracked_job_listbox.selection_set(selected_index)
            self.tracked_job_listbox.activate(selected_index)

        self.updating_tracked_jobs = False

    def _on_tracked_job_select(self, _event: tk.Event) -> None:
        if self.updating_tracked_jobs:
            return
        selection = self.tracked_job_listbox.curselection()
        if not selection:
            return
        selected_index = selection[0]
        if selected_index >= len(self.tracked_job_ids):
            return
        self.tracked_job_id = self.tracked_job_ids[selected_index]
        jobs = self.bridge.list_jobs()
        for job in jobs:
            if getattr(job, "job_id", "") != self.tracked_job_id:
                continue
            self.selected_node.set(getattr(job, "label", "Tracked job"))
            self.tracked_job_detail_text.set(build_tracked_job_detail(job))
            self.tracked_job_full_detail_text = build_tracked_job_detail(job, compact=False)
            self._refresh_tracked_job_action_buttons()
            return

    def _refresh_tracked_job_action_buttons(self) -> None:
        if not hasattr(self, "copy_tracked_job_detail_button"):
            return
        self._set_asset_button_state(
            self.copy_tracked_job_detail_button,
            bool(getattr(self, "tracked_job_id", "")) and bool(str(getattr(self, "tracked_job_full_detail_text", "")).strip()),
        )

    def _copy_tracked_job_detail(self) -> None:
        detail_text = str(getattr(self, "tracked_job_full_detail_text", "")).strip()
        if not detail_text or not getattr(self, "tracked_job_id", ""):
            self.status_text.set("Neni co kopirovat pro tracked job")
            return
        try:
            self.root.clipboard_clear()
            self.root.clipboard_append(detail_text)
            self.root.update_idletasks()
        except (AttributeError, RuntimeError, tk.TclError):
            self.status_text.set("Nepodarilo se zkopirovat tracked job detail")
            return
        self.status_text.set("Tracked job detail copied to clipboard")

    def _refresh_asset_preview(self) -> None:
        jobs = self.bridge.list_jobs()
        self._refresh_asset_history_filter_labels(jobs)
        history_jobs = asset_ready_jobs(jobs, limit=len(jobs), job_type_filter=self.asset_history_filter.get())
        if not self.asset_history_user_selected:
            selected_job_id = getattr(self, "asset_history_job_id", "")
            selected_job = next(
                (job for job in history_jobs if getattr(job, "job_id", "") == selected_job_id),
                None,
            )
            selected_is_ready_tileset = bool(
                selected_job is not None
                and getattr(selected_job, "job_type", "") == "tileset"
                and str(getattr(selected_job, "status", "")).strip().lower() == "ready"
                and (getattr(selected_job, "preview_url", "") or getattr(selected_job, "download_url", ""))
            )
            if not selected_is_ready_tileset and any(
                getattr(job, "job_type", "") == "tileset"
                and str(getattr(job, "status", "")).strip().lower() == "ready"
                and (getattr(job, "preview_url", "") or getattr(job, "download_url", ""))
                for job in history_jobs
            ):
                if selected_job is not None:
                    self._append_log(
                        f"15:04  Auto-promoted preview from {getattr(selected_job, 'job_type', 'asset')} to ready tileset"
                    )
                self.asset_history_job_id = ""
        chosen_job = choose_asset_job(
            history_jobs,
            self.asset_history_job_id,
            preferred_style_preset=self.server_style_preset.get(),
        )
        if chosen_job is not None:
            self.asset_history_job_id = chosen_job.job_id
        self._refresh_asset_history(history_jobs)
        if chosen_job is None:
            active_job = self._choose_live_processing_job(jobs)
            self.asset_history_job_id = ""
            self.active_visual_title = ""
            self.active_visual_subtitle = ""
            self.active_visual_job_type = ""
            self.pending_preview_url = ""
            self.preview_asset_url = ""
            self.download_asset_url = ""
            if active_job is None:
                self._set_asset_source_badge("waiting")
                self.asset_status_text.set("Preview se ukaze po dokonceni live jobu.")
                self.asset_meta_text.set("Zatim neni k dispozici zadny hotovy asset.")
            else:
                self._set_asset_source_badge("live-processing")
                self.asset_status_text.set(f"{getattr(active_job, 'label', 'PixelLab job')} | {getattr(active_job, 'status', 'processing')}")
                self.asset_meta_text.set(self._build_processing_asset_meta(active_job, jobs))
            self.asset_link_text.set("")
            self.asset_cache_text.set("Cache: zatim prazdna")
            self.asset_activity_error = ""
            self._refresh_asset_action_buttons()
            self._refresh_asset_activity_text()
            self._clear_preview_canvas("No preview yet")
            if active_job is None:
                self._clear_server_visuals("PixelLab server feed ceka na prvni ready asset.")
            else:
                self._render_processing_server_visual(active_job, jobs)
            return

        self.asset_history_job_id = chosen_job.job_id
        self.active_visual_title = chosen_job.asset_name or chosen_job.label
        self.active_visual_subtitle = self._build_server_visual_subtitle(chosen_job)
        self.active_visual_job_type = getattr(chosen_job, "job_type", "")
        self._set_asset_source_badge("live-ready")

        status_bits = [chosen_job.label, chosen_job.status]
        if chosen_job.source == "draft":
            status_bits.append("draft fallback")
        self.asset_status_text.set(" | ".join(status_bits))

        meta_lines = [f"Prompt: {self._compact_ui_text(chosen_job.prompt, 84)}"]
        if chosen_job.asset_name:
            meta_lines.append(f"Name: {chosen_job.asset_name}")
        if chosen_job.detail:
            meta_lines.append(f"Detail: {self._compact_ui_text(chosen_job.detail, 84)}")
        self.asset_meta_text.set("\n".join(meta_lines))

        self.preview_asset_url = chosen_job.preview_url
        self.download_asset_url = chosen_job.download_url
        if self.cached_preview_source_url != self.preview_asset_url:
            self.cached_preview_path = None
            self.cached_preview_source_url = ""
        if self.cached_download_source_url != self.download_asset_url:
            self.cached_download_path = None
            self.cached_download_source_url = ""
        self.asset_link_text.set(build_asset_link_text(chosen_job.preview_url, chosen_job.download_url))
        self._refresh_asset_action_buttons()
        self._refresh_asset_cache_text()
        self._refresh_asset_activity_text()

        preview_url = choose_preview_url(chosen_job.preview_url, chosen_job.download_url)
        if preview_url:
            if self.pending_preview_url == preview_url:
                return
            if not should_reload_preview(self.loaded_preview_url, preview_url, self.current_preview_image is not None):
                if self.current_preview_image is not None:
                    self._render_server_visual(
                        self.current_preview_image,
                        self.active_visual_title or "PixelLab asset",
                        self.active_visual_subtitle or "Server render feed",
                    )
                return
            self._start_preview_load(preview_url)
            return

        if chosen_job.status == "ready":
            self.pending_preview_url = ""
            self._clear_preview_canvas("Asset ready")
            self._clear_server_visuals("Ready asset nema preview URL, takze hlavni feed zatim zustava prazdny.")
        else:
            self.pending_preview_url = ""
            self._clear_preview_canvas("Waiting for asset")
            self._render_processing_server_visual(chosen_job, jobs)

    def _refresh_asset_history(self, jobs: list[object]) -> None:
        self.updating_asset_history = True
        self.asset_history_listbox.delete(0, tk.END)
        self.asset_history_ids = [job.job_id for job in jobs]
        for job in jobs:
            self.asset_history_listbox.insert(tk.END, summarize_asset_history_entry(job))

        if not jobs:
            self.asset_history_job_id = ""
            self.updating_asset_history = False
            return

        if self.asset_history_job_id not in self.asset_history_ids:
            self.asset_history_job_id = jobs[0].job_id

        selected_index = self.asset_history_ids.index(self.asset_history_job_id)
        self.asset_history_listbox.selection_clear(0, tk.END)
        self.asset_history_listbox.selection_set(selected_index)
        self.asset_history_listbox.activate(selected_index)
        self.updating_asset_history = False

    def _on_asset_history_select(self, _event: tk.Event) -> None:
        if self.updating_asset_history:
            return
        selection = self.asset_history_listbox.curselection()
        if not selection:
            return
        next_job_id = self.asset_history_ids[selection[0]]
        if next_job_id == self.asset_history_job_id:
            return
        self.asset_history_user_selected = True
        self.asset_history_job_id = next_job_id
        self._refresh_asset_preview()

    def _on_asset_history_filter_changed(self) -> None:
        self._persist_ui_preferences()
        self.asset_history_user_selected = False
        self.asset_history_job_id = ""
        self._refresh_asset_preview()

    def _on_server_style_preset_changed(self) -> None:
        normalized = normalize_server_style_preset(self.server_style_preset.get())
        self.server_style_preset.set(normalized)
        self.server_style_preset_text.set(server_style_preset_label(normalized))
        self._persist_ui_preferences()
        self.asset_history_user_selected = False
        self.asset_history_job_id = ""
        self.status_text.set(f"Server style preset: {server_style_preset_label(normalized)}")
        self._refresh_asset_preview()

    def _refresh_asset_history_filter_labels(self, jobs: list[object]) -> None:
        counts = asset_ready_counts(jobs)
        self.asset_history_filter_labels["all"].set(f"All ({counts['all']})")
        self.asset_history_filter_labels["character"].set(f"Characters ({counts['character']})")
        self.asset_history_filter_labels["tileset"].set(f"Tilesets ({counts['tileset']})")

    def _draw_visual_placeholder(self, canvas: tk.Canvas, title: str, subtitle: str, *, accent: str = "") -> None:
        canvas_width = int(canvas.cget("width"))
        canvas_height = int(canvas.cget("height"))
        accent_color = accent or PALETTE["gold"]
        canvas.delete("all")
        canvas.create_rectangle(0, 0, canvas_width, canvas_height, fill=PALETTE["night_sky"], outline="")
        # Glow border layers
        glow_key = next((k for k in ("glow_cyan", "glow_gold") if k in PALETTE), None)
        if glow_key:
            canvas.create_rectangle(8, 8, canvas_width - 8, canvas_height - 8, outline=PALETTE[glow_key], width=4)
        canvas.create_rectangle(14, 14, canvas_width - 14, canvas_height - 14, outline=PALETTE["panel_edge"], width=2)
        canvas.create_rectangle(20, 20, canvas_width - 20, canvas_height - 20, outline=accent_color, width=1)
        canvas.create_text(28, 30, text=title, anchor="nw", fill=PALETTE["moon"], font=(self.FONT_CODE, 11, "bold"), width=max(120, canvas_width - 56))
        canvas.create_text(28, canvas_height // 2 + 4, text=subtitle, anchor="w", fill=PALETTE["muted"], font=(self.FONT_CODE, 9), width=max(120, canvas_width - 56))

    def _clear_live_server_canvas(self, canvas: tk.Canvas) -> None:
        canvas.delete("all")

    def _choose_live_processing_job(self, jobs: list[object]) -> object | None:
        for status in ("processing", "queued", "running", "pending"):
            for job in jobs:
                if str(getattr(job, "status", "")).strip().lower() == status:
                    return job
        return None

    def _compact_ui_text(self, value: object, max_length: int = 72) -> str:
        normalized = " ".join(str(value or "").split())
        if len(normalized) <= max_length:
            return normalized
        return f"{normalized[: max_length - 3].rstrip()}..."

    def _build_server_visual_subtitle(self, job: object, max_length: int = 68) -> str:
        status = str(getattr(job, "status", "")).strip().lower() or "processing"
        summary = getattr(job, "asset_name", "") or getattr(job, "detail", "") or getattr(job, "prompt", "") or getattr(job, "label", "PixelLab asset")
        compact_summary = self._compact_ui_text(summary, max_length)
        if not compact_summary:
            return status
        return f"{status} | {compact_summary}"

    def _build_processing_asset_meta(self, active_job: object, jobs: list[object]) -> str:
        lines = [
            f"Prompt: {self._compact_ui_text(getattr(active_job, 'prompt', ''), 84)}",
            f"Status: {getattr(active_job, 'status', 'processing')}",
            f"Source: {getattr(active_job, 'source', 'mcp')}",
            f"Live jobs: {len(jobs)}",
        ]
        detail = str(getattr(active_job, "detail", "")).strip()
        if detail:
            lines.append(f"Detail: {self._compact_ui_text(detail, 84)}")
        return "\n".join(lines)

    def _render_processing_server_visual(self, active_job: object, jobs: list[object]) -> None:
        title = getattr(active_job, "asset_name", "") or getattr(active_job, "label", "PixelLab live feed")
        status = str(getattr(active_job, "status", "processing")).upper()
        if hasattr(self, "server_visual_text"):
            self.server_visual_text.set(f"Live PixelLab feed: {status} | {self._build_server_visual_subtitle(active_job)}")

        if hasattr(self, "hero_visual_canvas"):
            self.current_hero_image = None
            self._clear_live_server_canvas(self.hero_visual_canvas)

        if hasattr(self, "stage"):
            self.current_stage_image = None
            self._clear_live_server_canvas(self.stage)

    def _clear_server_visuals(self, message: str) -> None:
        self.current_stage_image = None
        self.current_hero_image = None
        if hasattr(self, "server_visual_text"):
            self.server_visual_text.set(message)
        live_tools = getattr(getattr(self, "bridge", None), "has_live_tools", False)
        if hasattr(self, "hero_visual_canvas"):
            if live_tools:
                self._clear_live_server_canvas(self.hero_visual_canvas)
            else:
                self._draw_visual_placeholder(
                    self.hero_visual_canvas,
                    "SERVER PORTRAIT",
                    "Zatim bez vygenerovaneho server assetu.",
                    accent=PALETTE["cyan"],
                )
        if hasattr(self, "stage"):
            if live_tools:
                self._clear_live_server_canvas(self.stage)
            else:
                self._draw_scene()

    def _stage_dimensions(self) -> tuple[int, int]:
        w = self.stage.winfo_width()
        h = self.stage.winfo_height()
        if w < 50:
            wv = str(self.stage.cget("width"))
            w = int(wv) if wv.isdigit() and int(wv) > 50 else 0
            if w < 50:
                try:
                    w = self.stage.master.winfo_width() - 40
                except (AttributeError, tk.TclError):
                    w = 600
                w = max(200, w)
        if h < 50:
            hv = str(self.stage.cget("height"))
            h = int(hv) if hv.isdigit() else 300
        return w, h

    def _render_server_visual(self, image: tk.PhotoImage, title: str, subtitle: str) -> None:
        if hasattr(self, "server_visual_text"):
            self.server_visual_text.set(f"{title} | {subtitle}")

        self._render_hero_portrait(image, title)

        if hasattr(self, "stage"):
            if self.active_visual_job_type == "tileset":
                canvas_width, canvas_height = self._stage_dimensions()
                self._append_log(f"15:04  Rendered tileset world feed: {title}")
                self._render_tileset_stage_visual(image, title, subtitle, canvas_width, canvas_height)
            elif self.current_stage_image is None:
                canvas_width, canvas_height = self._stage_dimensions()
                self._render_character_stage_visual(image, title, subtitle, canvas_width, canvas_height)

    def _render_hero_portrait(self, image: tk.PhotoImage, title: str) -> None:
        if not hasattr(self, "hero_visual_canvas"):
            return
        canvas_width = int(self.hero_visual_canvas.cget("width"))
        canvas_height = int(self.hero_visual_canvas.cget("height"))
        hero_image = self._scale_photoimage_to_bounds(image, canvas_width - 24, canvas_height - 34, upscale_limit=8)
        self.current_hero_image = hero_image
        self.hero_visual_canvas.delete("all")
        self.hero_visual_canvas.create_rectangle(0, 0, canvas_width, canvas_height, fill=PALETTE["night_sky"], outline="")
        self.hero_visual_canvas.create_image(canvas_width // 2, canvas_height // 2 + 10, image=hero_image)
        self.hero_visual_canvas.create_rectangle(6, 6, canvas_width - 6, 24, fill=PALETTE["panel_edge"], outline=PALETTE["panel_edge"])
        short_title = title[:30] + "..." if len(title) > 32 else title
        self.hero_visual_canvas.create_text(12, 15, text=short_title, anchor="w", fill=PALETTE["moon"], font=(self.FONT_CODE, 8, "bold"))

    def _render_character_stage_visual(self, image: tk.PhotoImage, title: str, subtitle: str, canvas_width: int, canvas_height: int) -> None:
        stage_image = self._scale_photoimage_to_bounds(image, canvas_width - 80, canvas_height - 60, upscale_limit=12)
        self.current_stage_image = stage_image
        self.stage.delete("all")
        self.stage.create_rectangle(0, 0, canvas_width, canvas_height, fill=PALETTE["night_sky"], outline="")
        self.stage.create_rectangle(16, 16, canvas_width - 16, canvas_height - 16, outline=PALETTE["panel_edge"], width=4)
        self.stage.create_image(canvas_width // 2, canvas_height // 2 + 6, image=stage_image)
        short_title = title[:40] + "..." if len(title) > 42 else title
        self.stage.create_rectangle(24, 24, canvas_width - 24, 48, fill=PALETTE["panel_edge"], outline=PALETTE["panel_edge"])
        self.stage.create_text(36, 36, text=short_title, anchor="w", fill=PALETTE["moon"], font=(self.FONT_CODE, 11, "bold"))

    def _render_tileset_stage_visual(
        self,
        image: tk.PhotoImage,
        title: str,
        subtitle: str,
        canvas_width: int,
        canvas_height: int,
    ) -> None:
        usable_width = max(120, canvas_width - 40)
        usable_height = max(120, canvas_height - 108)
        world_image = self._build_tileset_world_image(image, usable_width, usable_height)
        self.current_stage_image = world_image
        self.stage.delete("all")
        self.stage.create_rectangle(0, 0, canvas_width, canvas_height, fill=PALETTE["night_sky"], outline="")
        self.stage.create_image(20, 72, image=world_image, anchor="nw")

        self.stage.create_rectangle(16, 16, canvas_width - 16, canvas_height - 16, outline=PALETTE["panel_edge"], width=4)
        self.stage.create_rectangle(24, 24, canvas_width - 24, 56, fill=PALETTE["panel_edge"], outline=PALETTE["panel_edge"])
        short_title = title[:50] + "..." if len(title) > 52 else title
        self.stage.create_text(36, 40, text=short_title, anchor="w", fill=PALETTE["moon"], font=(self.FONT_CODE, 11, "bold"))
        short_sub = subtitle[:60] + "..." if len(subtitle) > 62 else subtitle
        self.stage.create_rectangle(24, canvas_height - 52, canvas_width - 24, canvas_height - 24, fill="#000000", outline=PALETTE["panel_edge"], stipple="gray25")
        self.stage.create_text(36, canvas_height - 38, text=short_sub, anchor="w", fill=PALETTE["moon"], font=(self.FONT_CODE, 9))

    def _build_tileset_world_image(self, image: tk.PhotoImage, width: int, height: int) -> tk.PhotoImage:
        source_width = self._photoimage_dimension(image, "width")
        source_height = self._photoimage_dimension(image, "height")
        if source_width < 4 or source_height < 4:
            return self._scale_photoimage_to_bounds(image, width, height, upscale_limit=6)

        tile_source_width = max(1, source_width // 4)
        tile_source_height = max(1, source_height // 4)
        desired_tile_width = min(128, max(64, width // 8))
        desired_tile_height = min(128, max(64, height // 4))
        zoom_factor = max(1, min(desired_tile_width // tile_source_width, desired_tile_height // tile_source_height, 12))
        tile_width = tile_source_width * zoom_factor
        tile_height = tile_source_height * zoom_factor
        output = tk.PhotoImage(width=width, height=height)

        row_count = max(1, (height + tile_height - 1) // tile_height)
        column_count = max(1, (width + tile_width - 1) // tile_width)
        for row in range(row_count):
            for column in range(column_count):
                tile_index = self._choose_tileset_pattern_index(row, column)
                source_column = tile_index % 4
                source_row = tile_index // 4
                source_x1 = source_column * tile_source_width
                source_y1 = source_row * tile_source_height
                source_x2 = source_x1 + tile_source_width
                source_y2 = source_y1 + tile_source_height
                dest_x = column * tile_width
                dest_y = row * tile_height
                output.tk.call(
                    str(output),
                    "copy",
                    str(image),
                    "-from",
                    source_x1,
                    source_y1,
                    source_x2,
                    source_y2,
                    "-to",
                    dest_x,
                    dest_y,
                    "-zoom",
                    zoom_factor,
                    zoom_factor,
                )

        return output

    def _choose_tileset_pattern_index(self, row: int, column: int) -> int:
        return (row * 5 + column * 3 + (row // 2) * 7 + (column // 3)) % 16

    def _photoimage_dimension(self, image: tk.PhotoImage, dimension: str) -> int:
        getter = getattr(image, dimension, None)
        if not callable(getter):
            return 0
        try:
            return int(getter())
        except (TypeError, ValueError):
            return 0

    def _scale_photoimage_to_bounds(
        self,
        image: tk.PhotoImage,
        max_width: int,
        max_height: int,
        *,
        upscale_limit: int = 1,
    ) -> tk.PhotoImage:
        source_width = self._photoimage_dimension(image, "width")
        source_height = self._photoimage_dimension(image, "height")

        if source_width <= 0 or source_height <= 0:
            return image

        fit_width = max(1, int(max_width))
        fit_height = max(1, int(max_height))

        zoom_factor = min(fit_width // source_width, fit_height // source_height, max(1, upscale_limit))
        if zoom_factor > 1 and hasattr(image, "zoom"):
            return image.zoom(zoom_factor, zoom_factor)

        subsample_factor = max(
            (source_width + fit_width - 1) // fit_width,
            (source_height + fit_height - 1) // fit_height,
        )
        if subsample_factor > 1 and hasattr(image, "subsample"):
            return image.subsample(subsample_factor, subsample_factor)

        return image

    def _clear_preview_canvas(self, label: str) -> None:
        canvas_width = int(self.preview_canvas.cget("width"))
        canvas_height = int(self.preview_canvas.cget("height"))
        center_x = canvas_width // 2
        center_y = canvas_height // 2
        self.current_preview_image = None
        self.loaded_preview_url = ""
        self.preview_canvas.delete("all")
        self.preview_canvas.create_rectangle(0, 0, canvas_width, canvas_height, fill=PALETTE["night_sky"], outline="")
        self.preview_canvas.create_text(center_x, center_y, text=label, fill=PALETTE["muted"], font=(self.FONT_UI_BOLD, 12))

    def _refresh_asset_activity_text(self) -> None:
        tone = asset_activity_tone(
            bool(self.preview_asset_url or self.download_asset_url),
            self.pending_preview_url,
            sorted(self.asset_action_in_progress),
            self.cache_refresh_in_progress,
            self.asset_activity_error,
        )
        self.asset_activity_text.set(
            build_asset_activity_text(
                bool(self.preview_asset_url or self.download_asset_url),
                self.pending_preview_url,
                sorted(self.asset_action_in_progress),
                self.cache_refresh_in_progress,
                self.asset_activity_error,
            )
        )
        self.asset_activity_label.configure(fg=self.STATUS_TONE_COLORS[tone])
        self._apply_status_card_tone(
            getattr(self, "summary_asset_card", None),
            getattr(self, "summary_asset_title_label", None),
            tone,
            getattr(self, "summary_asset_activity_label", None),
        )
        self._apply_status_card_tone(
            getattr(self, "sidebar_asset_card", None),
            getattr(self, "sidebar_asset_title_label", None),
            tone,
            getattr(self, "sidebar_asset_activity_label", None),
            getattr(self, "sidebar_asset_cache_label", None),
        )

    def _refresh_bridge_activity_text(self) -> None:
        tone = bridge_activity_tone(
            sorted(self.bridge_action_in_progress),
            self.bridge_activity_error,
            self.poll_debounce_after_id is not None,
            self.poll_follow_up_requested,
            self.auto_poll_after_id is not None,
        )
        self.bridge_activity_text.set(
            build_bridge_activity_text(
                sorted(self.bridge_action_in_progress),
                self.bridge_activity_error,
                self.poll_debounce_after_id is not None,
                self.poll_follow_up_requested,
                self.auto_poll_after_id is not None,
                self.auto_poll_enabled.get(),
                self.auto_poll_seconds.get(),
            )
        )
        self.bridge_activity_label.configure(fg=self.STATUS_TONE_COLORS[tone])
        self._apply_status_card_tone(
            getattr(self, "summary_queue_card", None),
            getattr(self, "summary_queue_title_label", None),
            tone,
            getattr(self, "summary_bridge_activity_label", None),
        )
        self._apply_status_card_tone(
            getattr(self, "sidebar_bridge_card", None),
            getattr(self, "sidebar_bridge_title_label", None),
            tone,
            getattr(self, "sidebar_bridge_activity_label", None),
            getattr(self, "sidebar_job_summary_label", None),
        )

    def _start_preview_load(self, url: str) -> None:
        self.preview_request_id += 1
        request_id = self.preview_request_id
        self.pending_preview_url = url
        self.asset_activity_error = ""
        self._append_log(f"15:04  Preview load started: {url}")
        self._refresh_asset_activity_text()
        self._clear_preview_canvas("Loading preview...")
        self._clear_server_visuals("Loading PixelLab server visual...")
        worker = threading.Thread(target=self._load_preview_image_worker, args=(url, request_id), daemon=True)
        worker.start()

    def _load_preview_image_worker(self, url: str, request_id: int) -> None:
        try:
            cached_path, _created = ensure_asset_cached(url, timeout=3, auth_headers=self._auth_for_url(url))
        except (OSError, ValueError, urlerror.URLError):
            self._dispatch_to_ui(lambda: self._apply_preview_load(url, request_id, None))
            return

        self._dispatch_to_ui(lambda: self._apply_preview_load(url, request_id, cached_path))

    def _apply_preview_load(self, url: str, request_id: int, cached_path: Path | None) -> None:
        if not should_apply_preview_result(self.preview_request_id, request_id, self.pending_preview_url, url):
            return

        self.pending_preview_url = ""
        if cached_path is None:
            self.asset_activity_error = "Preview could not be loaded"
            self._refresh_asset_activity_text()
            self._clear_preview_canvas("Preview URL ready")
            self._clear_server_visuals("Preview URL ready, ale obraz se nepodarilo nacist.")
            return

        try:
            image = tk.PhotoImage(file=str(cached_path))
        except tk.TclError:
            self.asset_activity_error = "Preview format is not supported"
            self._refresh_asset_activity_text()
            self._clear_preview_canvas("Preview URL ready")
            self._clear_server_visuals("Server vratil preview v nepodporovanem formatu.")
            return

        self.asset_activity_error = ""
        self.current_preview_image = image
        self.loaded_preview_url = url
        self.cached_preview_path = cached_path
        self.cached_preview_source_url = url
        self._append_log(f"15:04  Preview load applied: {self.active_visual_job_type or 'asset'} | {url}")
        self._refresh_asset_cache_text()
        self._refresh_asset_activity_text()
        self.preview_canvas.delete("all")
        canvas_width = int(self.preview_canvas.cget("width"))
        canvas_height = int(self.preview_canvas.cget("height"))
        self.preview_canvas.create_rectangle(0, 0, canvas_width, canvas_height, fill=PALETTE["night_sky"], outline="")
        scaled = self._scale_photoimage_to_bounds(image, canvas_width - 8, canvas_height - 8, upscale_limit=8)
        self.current_preview_scaled = scaled
        self.preview_canvas.create_image(canvas_width // 2, canvas_height // 2, image=scaled)
        visual_title = self.active_visual_title or "PixelLab asset"
        visual_subtitle = self.active_visual_subtitle or "Server render feed"
        self._render_server_visual(image, visual_title, visual_subtitle)
        if self.active_visual_job_type == "tileset":
            save_visual_bootstrap_state(
                cached_path,
                preview_url=url,
                download_url=self.download_asset_url,
                job_type=self.active_visual_job_type,
                title=visual_title,
                subtitle=visual_subtitle,
            )

    def _set_asset_button_state(self, button: tk.Button, enabled: bool) -> None:
        button.configure(state="normal" if enabled else "disabled")
        self._apply_button_palette(button, enabled)

    def _refresh_asset_action_buttons(self) -> None:
        self._set_asset_button_state(
            self.preview_link_button,
            bool(self.preview_asset_url) and "open_preview" not in self.asset_action_in_progress,
        )
        self._set_asset_button_state(
            self.download_link_button,
            bool(self.download_asset_url) and "open_download" not in self.asset_action_in_progress,
        )
        self._set_asset_button_state(
            self.save_preview_button,
            bool(self.preview_asset_url) and "save_preview" not in self.asset_action_in_progress,
        )
        self._set_asset_button_state(
            self.save_download_button,
            bool(self.download_asset_url) and "save_download" not in self.asset_action_in_progress,
        )
        self._set_asset_button_state(
            self.refresh_cache_button,
            bool(self.preview_asset_url or self.download_asset_url) and not self.cache_refresh_in_progress,
        )
        self._refresh_asset_activity_text()

    def _refresh_bridge_action_buttons(self) -> None:
        self._set_asset_button_state(self.queue_character_button, "queue_character" not in self.bridge_action_in_progress)
        self._set_asset_button_state(self.queue_tileset_button, "queue_tileset" not in self.bridge_action_in_progress)
        self._set_asset_button_state(self.poll_jobs_button, True)
        self._refresh_bridge_activity_text()

    def _begin_bridge_action(self, action_key: str) -> int:
        self.bridge_action_request_seq += 1
        request_id = self.bridge_action_request_seq
        self.bridge_action_request_ids[action_key] = request_id
        self.bridge_action_in_progress.add(action_key)
        self._refresh_bridge_action_buttons()
        return request_id

    def _finish_bridge_action(self, action_key: str, request_id: int) -> bool:
        if self.bridge_action_request_ids.get(action_key) != request_id:
            return False
        self.bridge_action_in_progress.discard(action_key)
        self._refresh_bridge_action_buttons()
        return True

    def _begin_asset_action(self, action_key: str) -> int:
        self.asset_action_request_seq += 1
        request_id = self.asset_action_request_seq
        self.asset_action_request_ids[action_key] = request_id
        self.asset_action_in_progress.add(action_key)
        self._refresh_asset_action_buttons()
        return request_id

    def _finish_asset_action(self, action_key: str, request_id: int) -> bool:
        if self.asset_action_request_ids.get(action_key) != request_id:
            return False
        self.asset_action_in_progress.discard(action_key)
        self._refresh_asset_action_buttons()
        return True

    def _open_asset_url(self, url: str, label: str) -> None:
        if not url:
            return
        action_key = f"open_{label}"
        request_id = self._begin_asset_action(action_key)
        self.asset_activity_error = ""
        self.status_text.set(f"Preparing {label} asset...")
        worker = threading.Thread(target=self._resolve_asset_for_open_worker, args=(url, label, action_key, request_id), daemon=True)
        worker.start()

    def _open_runtime_log_directory(self) -> None:
        log_path = getattr(self, "external_log_path", None)
        log_dir = log_path.parent if isinstance(log_path, Path) else Path(tempfile.gettempdir())
        opened = webbrowser.open_new_tab(browser_url_for_path(log_dir))
        if opened:
            self.status_text.set("Opened runtime log folder")
            self._append_log(f"15:05  Opened runtime log folder: {log_dir}")
            return
        self.status_text.set("Nepodarilo se otevrit log folder")
        self._append_log(f"15:05  Failed to open runtime log folder: {log_dir}")

    def _resolve_asset_for_open_worker(self, url: str, label: str, action_key: str, request_id: int) -> None:
        try:
            cached_path, _created = ensure_asset_cached(url, timeout=3, auth_headers=self._auth_for_url(url))
        except (OSError, ValueError, urlerror.URLError):
            self._dispatch_to_ui(lambda: self._apply_open_asset_result(url, label, action_key, request_id, None))
            return
        self._dispatch_to_ui(lambda: self._apply_open_asset_result(url, label, action_key, request_id, cached_path))

    def _apply_open_asset_result(self, url: str, label: str, action_key: str, request_id: int, local_path: Path | None) -> None:
        if not self._finish_asset_action(action_key, request_id):
            return
        if local_path is None:
            self.asset_activity_error = f"Could not cache {label} asset"
            self._refresh_asset_activity_text()
            self.status_text.set(f"Nepodarilo se pripravit {label} asset")
            self._append_log(f"15:04  Failed to cache {label} asset")
            return
        self.asset_activity_error = ""
        self._store_cached_asset_path(label, url, local_path)
        opened = webbrowser.open_new_tab(browser_url_for_path(local_path))
        if opened:
            self.status_text.set(f"Opened cached {label} asset")
            self._append_log(f"15:04  Opened cached {label} asset")
            self._refresh_asset_cache_text()
            return
        self.asset_activity_error = f"Browser could not open {label} asset"
        self._refresh_asset_activity_text()
        self.status_text.set(f"Nepodarilo se otevrit cached {label} asset")
        self._append_log(f"15:04  Failed to open cached {label} asset")

    def _store_cached_asset_path(self, label: str, url: str, cached_path: Path) -> None:
        if label == "preview":
            self.cached_preview_path = cached_path
            self.cached_preview_source_url = url
        else:
            self.cached_download_path = cached_path
            self.cached_download_source_url = url
        self._refresh_asset_cache_text()

    def _resolve_cached_asset_path(self, url: str, label: str) -> Path | None:
        if label == "preview" and self.cached_preview_source_url == url and self.cached_preview_path is not None:
            return self.cached_preview_path
        if label == "download" and self.cached_download_source_url == url and self.cached_download_path is not None:
            return self.cached_download_path
        return self._ensure_cached_asset(url, label, quiet=False)

    def _ensure_cached_asset(self, url: str, label: str, quiet: bool, force_refresh: bool = False) -> Path | None:
        try:
            cached_path, created = ensure_asset_cached(url, timeout=3, force_refresh=force_refresh, auth_headers=self._auth_for_url(url))
        except (OSError, ValueError, urlerror.URLError):
            if not quiet:
                self.status_text.set(f"Nepodarilo se stahnout {label} asset")
            return None

        if label == "preview":
            self.cached_preview_path = cached_path
            self.cached_preview_source_url = url
        else:
            self.cached_download_path = cached_path
            self.cached_download_source_url = url

        if not quiet:
            verb = "Refreshed" if force_refresh else "Cached" if created else "Using cached"
            self.status_text.set(f"{verb} {label} asset")
            self._append_log(f"15:04  {verb} {label} asset")
        self._refresh_asset_cache_text()
        return cached_path

    def _refresh_asset_cache_text(self) -> None:
        preferred_path = self.cached_download_path or self.cached_preview_path
        if preferred_path is None:
            self.asset_cache_text.set("Cache: asset jeste neni lokalne ulozen")
            return
        label = "download" if self.cached_download_path is not None else "preview"
        self.asset_cache_text.set(f"Cache {label}: {preferred_path}")

    def _save_cached_asset_as(self, label: str) -> None:
        source_url = asset_action_url(label, self.preview_asset_url, self.download_asset_url)
        if not source_url:
            self.asset_activity_error = f"No {label} asset available for export"
            self._refresh_asset_activity_text()
            self.status_text.set(f"Neni co exportovat pro {label}")
            self._append_log(f"15:05  Save {label} skipped: nothing cached")
            return

        action_key = f"save_{label}"
        request_id = self._begin_asset_action(action_key)
        self.asset_activity_error = ""
        self.status_text.set(f"Preparing {label} export...")
        worker = threading.Thread(target=self._resolve_asset_for_save_worker, args=(source_url, label, action_key, request_id), daemon=True)
        worker.start()

    def _resolve_asset_for_save_worker(self, url: str, label: str, action_key: str, request_id: int) -> None:
        try:
            cached_path, _created = ensure_asset_cached(url, timeout=3, auth_headers=self._auth_for_url(url))
        except (OSError, ValueError, urlerror.URLError):
            self._dispatch_to_ui(lambda: self._apply_save_asset_result(url, label, action_key, request_id, None))
            return
        self._dispatch_to_ui(lambda: self._apply_save_asset_result(url, label, action_key, request_id, cached_path))

    def _apply_save_asset_result(self, url: str, label: str, action_key: str, request_id: int, source_path: Path | None) -> None:
        if not self._finish_asset_action(action_key, request_id):
            return
        if source_path is None:
            self.asset_activity_error = f"Could not prepare {label} export"
            self._refresh_asset_activity_text()
            self.status_text.set(f"Nepodarilo se pripravit export pro {label}")
            self._append_log(f"15:05  Save {label} failed: cache miss")
            return

        self.asset_activity_error = ""
        self._store_cached_asset_path(label, url, source_path)

        target = filedialog.asksaveasfilename(
            title=f"Save cached {label}",
            initialfile=suggested_asset_name(url, fallback_name=source_path.name),
        )
        if not target:
            return

        export_cached_asset(source_path, Path(target))
        self.status_text.set(f"{label.capitalize()} exported to selected path")
        self._append_log(f"15:05  Exported cached {label}")

    def _refresh_cached_assets(self) -> None:
        targets = cache_refresh_targets(self.preview_asset_url, self.download_asset_url)
        if not targets:
            self.asset_activity_error = "No asset URLs available for refresh"
            self._refresh_asset_activity_text()
            self.status_text.set("Neni co refreshnout v cache")
            self._append_log("15:05  Refresh cache skipped: no asset urls")
            return

        self.cache_refresh_request_id += 1
        request_id = self.cache_refresh_request_id
        self.cache_refresh_in_progress = True
        self.asset_activity_error = ""
        self._set_asset_button_state(self.refresh_cache_button, False)
        self.status_text.set("Refreshing asset cache...")
        worker = threading.Thread(target=self._refresh_cached_assets_worker, args=(targets, request_id), daemon=True)
        worker.start()

    def _refresh_cached_assets_worker(self, targets: list[tuple[str, str]], request_id: int) -> None:
        paths_by_url: dict[str, Path] = {}
        refreshed_labels: list[str] = []
        errors: list[str] = []

        for label, url in targets:
            try:
                cached_path = paths_by_url.get(url)
                if cached_path is None:
                    cached_path, _created = ensure_asset_cached(url, timeout=3, force_refresh=True, auth_headers=self._auth_for_url(url))
                    paths_by_url[url] = cached_path
            except (OSError, ValueError, urlerror.URLError):
                errors.append(label)
                continue

            refreshed_labels.append(label)

        self._dispatch_to_ui(lambda: self._apply_cached_asset_refresh(targets, paths_by_url, refreshed_labels, errors, request_id))

    def _apply_cached_asset_refresh(
        self,
        targets: list[tuple[str, str]],
        paths_by_url: dict[str, Path],
        refreshed_labels: list[str],
        errors: list[str],
        request_id: int,
    ) -> None:
        if request_id != self.cache_refresh_request_id:
            return

        self.cache_refresh_in_progress = False
        for label, url in targets:
            cached_path = paths_by_url.get(url)
            if cached_path is None:
                continue
            if label == "preview":
                self._store_cached_asset_path(label, url, cached_path)
                self.loaded_preview_url = ""
            else:
                self._store_cached_asset_path(label, url, cached_path)

        self._refresh_asset_action_buttons()

        if refreshed_labels:
            self.asset_activity_error = ""
            summary = ", ".join(refreshed_labels)
            self.status_text.set(f"Refreshed {summary} asset")
            self._append_log(f"15:05  Refreshed {summary} asset")
            preview_url = choose_preview_url(self.preview_asset_url, self.download_asset_url)
            if preview_url and any(label == "preview" for label in refreshed_labels):
                self._start_preview_load(preview_url)

        if errors:
            failed = ", ".join(errors)
            self.asset_activity_error = f"Refresh failed for: {failed}"
            self._refresh_asset_activity_text()
            self.status_text.set(f"Nepodarilo se refreshnout: {failed}")
            self._append_log(f"15:05  Refresh cache failed: {failed}")


if __name__ == "__main__":
    PixelWorkspaceApp().run()