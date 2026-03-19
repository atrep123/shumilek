from __future__ import annotations

import os
from queue import SimpleQueue
from pathlib import Path
import tempfile
import time
import unittest
from unittest import mock

from projects.shumilek_ui.main import PALETTE, PixelWorkspaceApp
from projects.shumilek_ui.pixellab_bridge import PixelLabJob


class _FakeVar:
    def __init__(self, value: object = "") -> None:
        self.value = value

    def get(self) -> object:
        return self.value

    def set(self, value: object) -> None:
        self.value = value


class _FakeRoot:
    def __init__(self) -> None:
        self.titled = ""
        self.geometry_value = ""
        self.minsize_value: tuple[int, int] | None = None
        self.configure_kwargs: dict[str, object] = {}
        self.after_calls: list[tuple[int, object]] = []
        self.after_cancel_calls: list[str] = []
        self.protocol_calls: list[tuple[str, object]] = []
        self.bind_calls: list[tuple[str, object, object]] = []
        self._after_seq = 0
        self.destroy_count = 0
        self.mainloop_count = 0
        self.exists = True
        self.clipboard_value = ""
        self.clipboard_clear_count = 0
        self.update_idletasks_count = 0

    def title(self, value: str) -> None:
        self.titled = value

    def geometry(self, value: str) -> None:
        self.geometry_value = value

    def minsize(self, width: int, height: int) -> None:
        self.minsize_value = (width, height)

    def configure(self, **kwargs: object) -> None:
        self.configure_kwargs.update(kwargs)

    def after(self, delay_ms: int, callback: object) -> str:
        self.after_calls.append((delay_ms, callback))
        self._after_seq += 1
        return f"after-{self._after_seq}"

    def after_cancel(self, after_id: str) -> None:
        self.after_cancel_calls.append(after_id)

    def protocol(self, name: str, callback: object) -> None:
        self.protocol_calls.append((name, callback))

    def bind(self, sequence: str, callback: object, add: object = None) -> None:
        self.bind_calls.append((sequence, callback, add))

    def destroy(self) -> None:
        self.destroy_count += 1
        self.exists = False

    def clipboard_clear(self) -> None:
        self.clipboard_clear_count += 1
        self.clipboard_value = ""

    def clipboard_append(self, value: str) -> None:
        self.clipboard_value += value

    def update_idletasks(self) -> None:
        self.update_idletasks_count += 1

    def mainloop(self) -> None:
        self.mainloop_count += 1

    def winfo_exists(self) -> int:
        return 1 if self.exists else 0


class _FakeBridge:
    def __init__(self, jobs: list[object], *, has_live_tools: bool = False, tool_bindings: dict[str, object] | None = None) -> None:
        self.jobs = jobs
        self.has_live_tools = has_live_tools
        self.tool_bindings = tool_bindings or {}

    def list_jobs(self) -> list[object]:
        return list(self.jobs)

    def refresh_jobs(self) -> list[object]:
        return list(self.jobs)

    def get_mode_label(self) -> str:
        return "fake-mode"


class _HangingThread:
    def __init__(self, target: object = None, args: tuple[object, ...] = (), daemon: bool = False) -> None:
        self.target = target
        self.args = args
        self.daemon = daemon
        self.started = False

    def start(self) -> None:
        self.started = True

    def join(self, _timeout: float | None = None) -> None:
        return None

    def is_alive(self) -> bool:
        return self.started


class _FakeListbox:
    def __init__(self) -> None:
        self.items: list[str] = []
        self.item_options: dict[int, dict[str, object]] = {}
        self.selected_index: int | None = None
        self.active_index: int | None = None

    def delete(self, _start: object, _end: object = None) -> None:
        self.items.clear()
        self.item_options.clear()
        self.selected_index = None
        self.active_index = None

    def insert(self, _index: object, value: str) -> None:
        self.items.append(value)

    def selection_clear(self, _start: object, _end: object = None) -> None:
        self.selected_index = None

    def selection_set(self, index: int) -> None:
        self.selected_index = index

    def activate(self, index: int) -> None:
        self.active_index = index

    def curselection(self) -> tuple[int, ...]:
        if self.selected_index is None:
            return ()
        return (self.selected_index,)

    def itemconfig(self, index: int, **kwargs: object) -> None:
        self.item_options.setdefault(index, {}).update(kwargs)


class _FakeWidget:
    def __init__(self) -> None:
        self.options: dict[str, object] = {}

    def configure(self, **kwargs: object) -> None:
        self.options.update(kwargs)


class _FakeCanvas:
    def __init__(self, width: int = 920, height: int = 310) -> None:
        self.width = width
        self.height = height
        self.deleted_tags: list[object] = []
        self.rectangles: list[tuple[object, ...]] = []
        self.images: list[tuple[tuple[object, ...], dict[str, object]]] = []
        self.texts: list[tuple[tuple[object, ...], dict[str, object]]] = []

    def winfo_width(self) -> int:
        return self.width

    def winfo_height(self) -> int:
        return self.height

    def cget(self, key: str) -> str:
        if key == "width":
            return str(self.width)
        if key == "height":
            return str(self.height)
        raise KeyError(key)

    def delete(self, tag: object) -> None:
        self.deleted_tags.append(tag)

    def create_rectangle(self, *args: object, **_kwargs: object) -> None:
        self.rectangles.append(args)

    def create_image(self, *args: object, **_kwargs: object) -> None:
        self.images.append((args, dict(_kwargs)))

    def create_text(self, *args: object, **_kwargs: object) -> None:
        self.texts.append((args, dict(_kwargs)))


class _FakePhotoImage:
    def __init__(self, width: int = 48, height: int = 48, *, tag: str = "base") -> None:
        self._width = width
        self._height = height
        self.tag = tag

    def width(self) -> int:
        return self._width

    def height(self) -> int:
        return self._height

    def zoom(self, x: int, y: int) -> _FakePhotoImage:
        return _FakePhotoImage(self._width * x, self._height * y, tag=f"zoom:{x}x:{self.tag}")

    def subsample(self, x: int, y: int) -> _FakePhotoImage:
        return _FakePhotoImage(max(1, self._width // x), max(1, self._height // y), tag=f"subsample:{x}x:{self.tag}")


class PixelWorkspaceAppFlowTests(unittest.TestCase):
    def _patch_fake_var_types(self) -> mock._patch:
        return mock.patch.multiple(
            "projects.shumilek_ui.main.tk",
            StringVar=mock.Mock(side_effect=lambda value="": _FakeVar(value)),
            BooleanVar=mock.Mock(side_effect=lambda value=False: _FakeVar(value)),
            IntVar=mock.Mock(side_effect=lambda value=0: _FakeVar(value)),
        )

    def _make_app(self) -> PixelWorkspaceApp:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.bridge_action_request_ids = {"poll_jobs": 5}
        app.bridge_action_in_progress = {"poll_jobs"}
        app.poll_follow_up_requested = False
        app.poll_debounce_after_id = None
        app.bridge_activity_error = "stale"
        app.bootstrap_visual_generation_requested = False
        app.bootstrap_poll_attempts_remaining = 0
        app.bootstrap_poll_after_id = None
        app.status_text = _FakeVar()
        app._refresh_bridge_action_buttons = lambda: None
        app._refresh_bridge_activity_text = lambda: None
        app._refresh_job_summary_called = 0
        app._refresh_asset_preview_called = 0
        app._poll_jobs_called = 0
        app._schedule_auto_poll_called = 0
        app._schedule_bootstrap_poll_called: list[int] = []
        app._cancel_bootstrap_poll_called = 0
        app.log_lines: list[str] = []

        def refresh_job_summary() -> None:
            app._refresh_job_summary_called += 1

        def refresh_asset_preview() -> None:
            app._refresh_asset_preview_called += 1

        def poll_jobs() -> None:
            app._poll_jobs_called += 1

        def schedule_auto_poll() -> None:
            app._schedule_auto_poll_called += 1

        def schedule_bootstrap_poll(delay_ms: int = 2500) -> None:
            app._schedule_bootstrap_poll_called.append(delay_ms)

        def cancel_bootstrap_poll() -> None:
            app._cancel_bootstrap_poll_called += 1

        def append_log(line: str) -> None:
            app.log_lines.append(line)

        app._refresh_job_summary = refresh_job_summary
        app._refresh_asset_preview = refresh_asset_preview
        app._poll_jobs = poll_jobs
        app._schedule_auto_poll = schedule_auto_poll
        app._schedule_bootstrap_poll = schedule_bootstrap_poll
        app._cancel_bootstrap_poll = cancel_bootstrap_poll
        app._append_log = append_log
        return app

    def _make_preview_app(self, jobs: list[object], history_filter: str = "all", selected_job_id: str = "") -> PixelWorkspaceApp:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.bridge = _FakeBridge(jobs)
        app.asset_history_filter = _FakeVar(history_filter)
        app.server_style_preset = _FakeVar("graph_workbench")
        app.asset_history_filter_labels = {
            "all": _FakeVar(),
            "character": _FakeVar(),
            "tileset": _FakeVar(),
        }
        app.asset_history_listbox = _FakeListbox()
        app.asset_history_ids = []
        app.asset_history_job_id = selected_job_id
        app.asset_history_user_selected = False
        app.pending_preview_url = ""
        app.preview_asset_url = "old-preview"
        app.download_asset_url = "old-download"
        app.asset_status_text = _FakeVar()
        app.asset_source_badge_text = _FakeVar()
        app.asset_meta_text = _FakeVar()
        app.asset_link_text = _FakeVar()
        app.asset_cache_text = _FakeVar()
        app.sidebar_asset_source_label = _FakeWidget()
        app.summary_asset_source_label = _FakeWidget()
        app.preview_asset_source_label = _FakeWidget()
        app.asset_activity_error = "old error"
        app.cached_preview_path = object()
        app.cached_preview_source_url = "stale-preview"
        app.cached_download_path = object()
        app.cached_download_source_url = "stale-download"
        app.loaded_preview_url = ""
        app.current_preview_image = None
        app.active_visual_title = ""
        app.active_visual_subtitle = ""
        app.active_visual_job_type = ""
        app.updating_asset_history = False
        app.cleared_preview_label = None
        app.started_preview_url = None
        app.processing_visual_calls: list[str] = []
        app.asset_action_refresh_count = 0
        app.asset_activity_refresh_count = 0
        app.log_lines: list[str] = []

        def refresh_asset_action_buttons() -> None:
            app.asset_action_refresh_count += 1

        def refresh_asset_activity_text() -> None:
            app.asset_activity_refresh_count += 1

        def clear_preview_canvas(label: str) -> None:
            app.cleared_preview_label = label

        def start_preview_load(url: str) -> None:
            app.started_preview_url = url

        def render_processing_server_visual(job: object, _jobs: list[object]) -> None:
            app.processing_visual_calls.append(getattr(job, "job_id", ""))

        app._refresh_asset_action_buttons = refresh_asset_action_buttons
        app._refresh_asset_activity_text = refresh_asset_activity_text
        app._clear_preview_canvas = clear_preview_canvas
        app._start_preview_load = start_preview_load
        app._render_processing_server_visual = render_processing_server_visual
        app._append_log = lambda line: app.log_lines.append(line)
        app._refresh_asset_cache_text = lambda: PixelWorkspaceApp._refresh_asset_cache_text(app)
        return app

    def _make_preview_loader_app(self) -> PixelWorkspaceApp:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.preview_request_id = 7
        app.pending_preview_url = "https://example.invalid/live.png"
        app.asset_activity_error = ""
        app.log_lines: list[str] = []
        app.current_preview_image = None
        app.loaded_preview_url = ""
        app.cached_preview_path = None
        app.cached_preview_source_url = ""
        app.download_asset_url = ""
        app.active_visual_title = "Live asset"
        app.active_visual_subtitle = "Server render feed"
        app.active_visual_job_type = "character"
        app.preview_canvas = _FakeCanvas(width=320, height=240)
        app.asset_cache_text = _FakeVar()
        app.asset_source_badge_text = _FakeVar()
        app.sidebar_asset_source_label = _FakeWidget()
        app.summary_asset_source_label = _FakeWidget()
        app.preview_asset_source_label = _FakeWidget()
        app.root = _FakeRoot()
        app._append_log = lambda line: app.log_lines.append(line)
        app._refresh_asset_cache_text = lambda: None
        app._refresh_asset_activity_text = lambda: None
        app._clear_preview_canvas = mock.Mock()
        app._clear_server_visuals = mock.Mock()
        app._render_server_visual = mock.Mock()
        return app

    def _make_tracked_jobs_app(self, jobs: list[object], selected_job_id: str = "") -> PixelWorkspaceApp:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.bridge = _FakeBridge(jobs)
        app.root = _FakeRoot()
        app.job_summary_text = _FakeVar()
        app.tracked_job_detail_text = _FakeVar()
        app.tracked_job_full_detail_text = ""
        app.tracked_job_listbox = _FakeListbox()
        app.tracked_job_ids = []
        app.tracked_job_id = selected_job_id
        app.updating_tracked_jobs = False
        app.selected_node = _FakeVar("Korunovy workspace")
        app.status_text = _FakeVar()
        return app

    def test_apply_poll_jobs_result_refreshes_summary_and_preview_on_success(self) -> None:
        app = self._make_app()

        app._apply_poll_jobs_result([object(), object()], "", 5)

        self.assertEqual(app.status_text.get(), "PixelLab poll complete: 2 jobu")
        self.assertEqual(app.bridge_activity_error, "")
        self.assertEqual(app._refresh_job_summary_called, 1)
        self.assertEqual(app._refresh_asset_preview_called, 1)
        self.assertEqual(app._schedule_auto_poll_called, 1)
        self.assertEqual(app._poll_jobs_called, 0)
        self.assertIn("15:03  Poll jobs: 2 tracked", app.log_lines)
        self.assertNotIn("poll_jobs", app.bridge_action_in_progress)

    def test_apply_poll_jobs_result_prefers_follow_up_poll_over_auto_schedule(self) -> None:
        app = self._make_app()
        app.poll_follow_up_requested = True

        app._apply_poll_jobs_result(None, "bridge down", 5)

        self.assertEqual(app.status_text.get(), "PixelLab poll failed: bridge down")
        self.assertEqual(app.bridge_activity_error, "bridge down")
        self.assertEqual(app._poll_jobs_called, 1)
        self.assertEqual(app._schedule_auto_poll_called, 0)
        self.assertEqual(app._refresh_job_summary_called, 0)
        self.assertEqual(app._refresh_asset_preview_called, 0)
        self.assertFalse(app.poll_follow_up_requested)
        self.assertIn("15:03  Poll jobs failed: bridge down", app.log_lines)

    def test_load_ui_preferences_restores_saved_values(self) -> None:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.auto_poll_enabled = _FakeVar(False)
        app.auto_poll_seconds = _FakeVar(3)
        app.asset_history_filter = _FakeVar("all")
        app.server_style_preset = _FakeVar("graph_workbench")
        app.server_style_preset_text = _FakeVar("Graph Workbench")

        with mock.patch(
            "projects.shumilek_ui.main.load_ui_settings",
            return_value={
                "auto_poll_enabled": True,
                "auto_poll_seconds": 9,
                "asset_history_filter": "tileset",
                "server_style_preset": "dark_network_map",
            },
        ):
            app._load_ui_preferences()

        self.assertTrue(app.auto_poll_enabled.get())
        self.assertEqual(app.auto_poll_seconds.get(), 9)
        self.assertEqual(app.asset_history_filter.get(), "tileset")
        self.assertEqual(app.server_style_preset.get(), "dark_network_map")

    def test_format_runtime_session_text_uses_unknown_for_blank_values(self) -> None:
        self.assertEqual(PixelWorkspaceApp._format_runtime_session_text("session-123"), "SESSION: session-123")
        self.assertEqual(PixelWorkspaceApp._format_runtime_session_text(""), "SESSION: unknown")
        self.assertEqual(PixelWorkspaceApp._format_runtime_session_text(None), "SESSION: unknown")

    def test_format_runtime_log_paths_text_uses_unknown_for_missing_paths(self) -> None:
        trace_path = Path("C:/temp/trace.log")
        fault_path = Path("C:/temp/fault.log")
        self.assertEqual(
            PixelWorkspaceApp._format_runtime_log_paths_text(trace_path, fault_path),
            "TRACE: trace.log\nFAULT: fault.log",
        )
        self.assertEqual(
            PixelWorkspaceApp._format_runtime_log_paths_text(None, None),
            "TRACE: unknown\nFAULT: unknown",
        )

    def test_init_loads_preferences_then_builds_layout_and_applies_initial_state(self) -> None:
        root = _FakeRoot()
        call_order: list[str] = []
        scheduled_delays: list[int] = []
        bridge_refresh_count = 0

        def fake_configure_style(app: PixelWorkspaceApp) -> None:
            call_order.append("configure_style")

        def fake_build_layout(app: PixelWorkspaceApp) -> None:
            call_order.append("build_layout")

        def fake_schedule_auto_poll(app: PixelWorkspaceApp, delay_ms: int = 3000) -> None:
            call_order.append("schedule_auto_poll")
            scheduled_delays.append(delay_ms)

        def fake_refresh_bridge_activity_text(app: PixelWorkspaceApp) -> None:
            nonlocal bridge_refresh_count
            call_order.append("refresh_bridge_activity_text")
            bridge_refresh_count += 1

        with mock.patch("projects.shumilek_ui.main.tk.Tk", return_value=root), \
            self._patch_fake_var_types(), \
            mock.patch("projects.shumilek_ui.main.PixelLabBridge", return_value=_FakeBridge([])), \
            mock.patch("projects.shumilek_ui.main.load_ui_settings", return_value={
                "auto_poll_enabled": True,
                "auto_poll_seconds": 11,
                "asset_history_filter": "tileset",
                "server_style_preset": "dark_network_map",
            }), \
            mock.patch("projects.shumilek_ui.main.faulthandler.enable") as mocked_fault_enable, \
            mock.patch("projects.shumilek_ui.main.atexit.register") as mocked_atexit_register, \
            mock.patch.object(PixelWorkspaceApp, "_configure_style", fake_configure_style), \
            mock.patch.object(PixelWorkspaceApp, "_build_layout", fake_build_layout), \
            mock.patch.object(PixelWorkspaceApp, "_schedule_auto_poll", fake_schedule_auto_poll), \
            mock.patch.object(PixelWorkspaceApp, "_refresh_bridge_activity_text", fake_refresh_bridge_activity_text):
            app = PixelWorkspaceApp()

        self.assertEqual(root.titled, "Shumilek - Pixel Workspace")
        self.assertEqual(root.geometry_value, "1440x920")
        self.assertEqual(root.minsize_value, (1220, 760))
        self.assertTrue(app.auto_poll_enabled.get())
        self.assertEqual(app.auto_poll_seconds.get(), 11)
        self.assertEqual(app.asset_history_filter.get(), "tileset")
        self.assertEqual(app.server_style_preset.get(), "dark_network_map")
        self.assertEqual(call_order, ["configure_style", "build_layout", "schedule_auto_poll"])
        self.assertEqual(scheduled_delays, [500])
        self.assertEqual(bridge_refresh_count, 0)
        self.assertEqual(root.protocol_calls[0][0], "WM_DELETE_WINDOW")
        self.assertEqual(root.bind_calls[0][0], "<Destroy>")
        self.assertTrue(app.external_log_path.name.startswith("shumilek_pixel_workspace_"))
        self.assertTrue(app.fault_log_path.name.startswith("shumilek_ui_fault_"))
        self.assertIn(app.runtime_session_id, app.external_log_path.name)
        self.assertIn(app.runtime_session_id, app.fault_log_path.name)
        self.assertEqual(app.runtime_session_text.get(), f"SESSION: {app.runtime_session_id}")
        self.assertEqual(
            app.runtime_log_paths_text.get(),
            f"TRACE: {app.external_log_path.name}\nFAULT: {app.fault_log_path.name}",
        )
        self.assertEqual(mocked_fault_enable.call_count, 1)
        self.assertEqual(mocked_atexit_register.call_count, 1)
        app._close_fault_handler()

    def test_open_runtime_log_directory_opens_parent_folder(self) -> None:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.status_text = _FakeVar()
        app.logs: list[str] = []
        app._append_log = lambda line: app.logs.append(line)
        app.external_log_path = Path(tempfile.gettempdir()) / "shumilek_pixel_workspace_session.log"

        with mock.patch("projects.shumilek_ui.main.browser_url_for_path", side_effect=lambda path: f"file:///{path.name}") as mocked_browser_url:
            with mock.patch("projects.shumilek_ui.main.webbrowser.open_new_tab", return_value=True) as mocked_open:
                app._open_runtime_log_directory()

        mocked_browser_url.assert_called_once_with(app.external_log_path.parent)
        mocked_open.assert_called_once_with(f"file:///{app.external_log_path.parent.name}")
        self.assertEqual(app.status_text.get(), "Opened runtime log folder")
        self.assertIn("Opened runtime log folder:", app.logs[0])

    def test_open_runtime_log_directory_reports_failure(self) -> None:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.status_text = _FakeVar()
        app.logs: list[str] = []
        app._append_log = lambda line: app.logs.append(line)
        app.external_log_path = Path(tempfile.gettempdir()) / "shumilek_pixel_workspace_session.log"

        with mock.patch("projects.shumilek_ui.main.webbrowser.open_new_tab", return_value=False):
            app._open_runtime_log_directory()

        self.assertEqual(app.status_text.get(), "Nepodarilo se otevrit log folder")
        self.assertIn("Failed to open runtime log folder:", app.logs[0])

    def test_configure_fault_handler_writes_session_marker(self) -> None:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.runtime_session_id = "fault-session-123"

        with tempfile.TemporaryDirectory() as temp_dir:
            fault_log_path = Path(temp_dir) / "fault.log"
            app.fault_log_path = fault_log_path
            app.fault_log_handle = None

            with mock.patch("projects.shumilek_ui.main.faulthandler.enable") as mocked_enable:
                app._configure_fault_handler()

            self.assertEqual(mocked_enable.call_count, 1)
            app._close_fault_handler()
            fault_text = fault_log_path.read_text(encoding="utf-8")

        self.assertIn("15:00  Fault session: fault-session-123", fault_text)
        self.assertIn("15:06  Fault handler trace closing | session=fault-session-123", fault_text)

    def test_cleanup_stale_session_logs_removes_only_old_matching_prefixes(self) -> None:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)

        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            stale_external = temp_path / "shumilek_pixel_workspace_stale.log"
            stale_fault = temp_path / "shumilek_ui_fault_stale.log"
            fresh_external = temp_path / "shumilek_pixel_workspace_fresh.log"
            unrelated = temp_path / "notes.log"
            current_external = temp_path / "shumilek_pixel_workspace_current.log"
            current_fault = temp_path / "shumilek_ui_fault_current.log"

            for path in (stale_external, stale_fault, fresh_external, unrelated, current_external, current_fault):
                path.write_text("log", encoding="utf-8")

            now = time.time()
            stale_time = now - (PixelWorkspaceApp.SESSION_LOG_RETENTION_SECONDS + 60)
            fresh_time = now - 60
            os.utime(stale_external, (stale_time, stale_time))
            os.utime(stale_fault, (stale_time, stale_time))
            os.utime(fresh_external, (fresh_time, fresh_time))
            os.utime(unrelated, (stale_time, stale_time))
            os.utime(current_external, (stale_time, stale_time))
            os.utime(current_fault, (stale_time, stale_time))

            app.external_log_path = current_external
            app.fault_log_path = current_fault

            removed_count = app._cleanup_stale_session_logs(now=now, base_dir=temp_path)

            self.assertEqual(removed_count, 2)
            self.assertFalse(stale_external.exists())
            self.assertFalse(stale_fault.exists())
            self.assertTrue(fresh_external.exists())
            self.assertTrue(unrelated.exists())
            self.assertTrue(current_external.exists())
            self.assertTrue(current_fault.exists())

    def test_init_logs_when_stale_session_cleanup_removed_entries(self) -> None:
        root = _FakeRoot()

        with mock.patch("projects.shumilek_ui.main.tk.Tk", return_value=root), \
            self._patch_fake_var_types(), \
            mock.patch("projects.shumilek_ui.main.PixelLabBridge", return_value=_FakeBridge([])), \
            mock.patch("projects.shumilek_ui.main.load_ui_settings", return_value={
                "auto_poll_enabled": False,
                "auto_poll_seconds": 4,
                "asset_history_filter": "all",
                "server_style_preset": "graph_workbench",
            }), \
            mock.patch("projects.shumilek_ui.main.faulthandler.enable"), \
            mock.patch("projects.shumilek_ui.main.atexit.register"), \
            mock.patch.object(PixelWorkspaceApp, "_configure_style", lambda _app: None), \
            mock.patch.object(PixelWorkspaceApp, "_build_layout", lambda _app: None), \
            mock.patch.object(PixelWorkspaceApp, "_refresh_bridge_activity_text", lambda _app: None), \
            mock.patch.object(PixelWorkspaceApp, "_cleanup_stale_session_logs", return_value=3):
            app = PixelWorkspaceApp()

        try:
            startup_log = app.external_log_path.read_text(encoding="utf-8")
            self.assertIn("15:00  Startup session:", startup_log)
            self.assertIn("15:00  Cleaned stale session logs: 3", startup_log)
        finally:
            app._close_fault_handler()
            if app.external_log_path.exists():
                app.external_log_path.unlink()
            if app.fault_log_path.exists():
                app.fault_log_path.unlink()

    def test_init_refreshes_bridge_when_saved_auto_poll_is_disabled(self) -> None:
        root = _FakeRoot()
        call_order: list[str] = []
        scheduled_delays: list[int] = []
        bridge_refresh_count = 0

        def fake_configure_style(app: PixelWorkspaceApp) -> None:
            call_order.append("configure_style")

        def fake_build_layout(app: PixelWorkspaceApp) -> None:
            call_order.append("build_layout")

        def fake_schedule_auto_poll(app: PixelWorkspaceApp, delay_ms: int = 3000) -> None:
            call_order.append("schedule_auto_poll")
            scheduled_delays.append(delay_ms)

        def fake_refresh_bridge_activity_text(app: PixelWorkspaceApp) -> None:
            nonlocal bridge_refresh_count
            call_order.append("refresh_bridge_activity_text")
            bridge_refresh_count += 1

        with mock.patch("projects.shumilek_ui.main.tk.Tk", return_value=root), \
            self._patch_fake_var_types(), \
            mock.patch("projects.shumilek_ui.main.PixelLabBridge", return_value=_FakeBridge([])), \
            mock.patch("projects.shumilek_ui.main.load_ui_settings", return_value={
                "auto_poll_enabled": False,
                "auto_poll_seconds": 4,
                "asset_history_filter": "all",
                "server_style_preset": "graph_workbench",
            }), \
            mock.patch.object(PixelWorkspaceApp, "_configure_style", fake_configure_style), \
            mock.patch.object(PixelWorkspaceApp, "_build_layout", fake_build_layout), \
            mock.patch.object(PixelWorkspaceApp, "_schedule_auto_poll", fake_schedule_auto_poll), \
            mock.patch.object(PixelWorkspaceApp, "_refresh_bridge_activity_text", fake_refresh_bridge_activity_text):
            app = PixelWorkspaceApp()

        self.assertFalse(app.auto_poll_enabled.get())
        self.assertEqual(app.auto_poll_seconds.get(), 4)
        self.assertEqual(app.asset_history_filter.get(), "all")
        self.assertEqual(app.server_style_preset.get(), "graph_workbench")
        self.assertEqual(call_order, ["configure_style", "build_layout", "refresh_bridge_activity_text"])
        self.assertEqual(scheduled_delays, [])
        self.assertEqual(bridge_refresh_count, 1)

    def test_apply_initial_ui_state_schedules_auto_poll_when_enabled(self) -> None:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.auto_poll_enabled = _FakeVar(True)
        app.schedule_delays: list[int] = []
        app.bridge_refresh_count = 0

        def schedule_auto_poll(delay_ms: int = 3000) -> None:
            app.schedule_delays.append(delay_ms)

        def refresh_bridge_activity_text() -> None:
            app.bridge_refresh_count += 1

        app._schedule_auto_poll = schedule_auto_poll
        app._refresh_bridge_activity_text = refresh_bridge_activity_text

        app._apply_initial_ui_state()

        self.assertEqual(app.schedule_delays, [500])
        self.assertEqual(app.bridge_refresh_count, 0)

    def test_apply_initial_ui_state_refreshes_bridge_when_auto_poll_disabled(self) -> None:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.auto_poll_enabled = _FakeVar(False)
        app.bridge = _FakeBridge([], has_live_tools=False)
        app.schedule_delays: list[int] = []
        app.bridge_refresh_count = 0
        app.bootstrap_count = 0

        def schedule_auto_poll(delay_ms: int = 3000) -> None:
            app.schedule_delays.append(delay_ms)

        def refresh_bridge_activity_text() -> None:
            app.bridge_refresh_count += 1

        def maybe_bootstrap_server_visuals() -> None:
            app.bootstrap_count += 1

        app._schedule_auto_poll = schedule_auto_poll
        app._refresh_bridge_activity_text = refresh_bridge_activity_text
        app._maybe_bootstrap_server_visuals = maybe_bootstrap_server_visuals

        app._apply_initial_ui_state()

        self.assertEqual(app.schedule_delays, [])
        self.assertEqual(app.bridge_refresh_count, 1)
        self.assertEqual(app.bootstrap_count, 1)

    def test_apply_initial_ui_state_syncs_remote_jobs_when_live_tools_are_available(self) -> None:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.auto_poll_enabled = _FakeVar(False)
        app.bridge = _FakeBridge([], has_live_tools=True)
        app.status_text = _FakeVar()
        app.poll_count = 0
        app.sync_count = 0
        app.schedule_delays: list[int] = []
        app.bridge_refresh_count = 0
        app.bootstrap_count = 0

        def poll_jobs() -> None:
            app.poll_count += 1

        def sync_initial_live_jobs() -> bool:
            app.sync_count += 1
            app.status_text.set("PixelLab sync complete: 0 jobu")
            return True

        app._poll_jobs = poll_jobs
        app._sync_initial_live_jobs = sync_initial_live_jobs
        app._schedule_auto_poll = lambda delay_ms=3000: app.schedule_delays.append(delay_ms)
        app._refresh_bridge_activity_text = lambda: setattr(app, "bridge_refresh_count", app.bridge_refresh_count + 1)
        app._maybe_bootstrap_server_visuals = lambda: setattr(app, "bootstrap_count", app.bootstrap_count + 1)

        app._apply_initial_ui_state()

        self.assertEqual(app.sync_count, 1)
        self.assertEqual(app.poll_count, 0)
        self.assertEqual(app.status_text.get(), "PixelLab sync complete: 0 jobu")
        self.assertEqual(app.schedule_delays, [])
        self.assertEqual(app.bridge_refresh_count, 0)
        self.assertEqual(app.bootstrap_count, 0)

    def test_apply_initial_ui_state_restores_cached_world_before_live_sync(self) -> None:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.auto_poll_enabled = _FakeVar(False)
        app.bridge = _FakeBridge([], has_live_tools=True)
        app.status_text = _FakeVar()
        call_order: list[str] = []

        app._restore_cached_bootstrap_visual = lambda: call_order.append("restore") or True
        app._sync_initial_live_jobs = lambda: call_order.append("sync") or True
        app._seed_live_jobs_async = lambda: call_order.append("seed-character")
        app._seed_tileset_jobs_async = lambda: call_order.append("seed-tileset")
        app._poll_jobs = lambda: call_order.append("poll")

        app._apply_initial_ui_state()

        self.assertEqual(call_order, ["restore", "sync"])

    def test_apply_initial_ui_state_starts_character_and_tileset_seed_when_live_sync_times_out(self) -> None:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.auto_poll_enabled = _FakeVar(True)
        app.bridge = _FakeBridge([], has_live_tools=True)
        app.status_text = _FakeVar()
        app.character_seed_count = 0
        app.tileset_seed_count = 0
        app.poll_count = 0

        app._sync_initial_live_jobs = lambda: False
        app._seed_live_jobs_async = lambda: setattr(app, "character_seed_count", app.character_seed_count + 1)
        app._seed_tileset_jobs_async = lambda: setattr(app, "tileset_seed_count", app.tileset_seed_count + 1)
        app._poll_jobs = lambda: setattr(app, "poll_count", app.poll_count + 1)

        app._apply_initial_ui_state()

        self.assertEqual(app.character_seed_count, 1)
        self.assertEqual(app.tileset_seed_count, 1)
        self.assertEqual(app.poll_count, 1)

    def test_apply_initial_ui_state_enables_auto_poll_and_seeds_when_live_sync_times_out(self) -> None:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.auto_poll_enabled = _FakeVar(False)
        app.bridge = _FakeBridge([], has_live_tools=True)
        app.status_text = _FakeVar()
        app.character_seed_count = 0
        app.tileset_seed_count = 0
        app.poll_count = 0
        app.bridge_refresh_count = 0

        app._sync_initial_live_jobs = lambda: False
        app._seed_live_jobs_async = lambda: setattr(app, "character_seed_count", app.character_seed_count + 1)
        app._seed_tileset_jobs_async = lambda: setattr(app, "tileset_seed_count", app.tileset_seed_count + 1)
        app._poll_jobs = lambda: setattr(app, "poll_count", app.poll_count + 1)
        app._refresh_bridge_activity_text = lambda: setattr(app, "bridge_refresh_count", app.bridge_refresh_count + 1)
        app._restore_cached_bootstrap_visual = lambda: None

        app._apply_initial_ui_state()

        self.assertTrue(app.auto_poll_enabled.get())
        self.assertEqual(app.character_seed_count, 1)
        self.assertEqual(app.tileset_seed_count, 1)
        self.assertEqual(app.poll_count, 1)

    def test_on_close_requested_cancels_pending_callbacks_and_destroys_root(self) -> None:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.root = _FakeRoot()
        app.close_requested = False
        app.ui_callback_after_id = "after-ui"
        app.poll_debounce_after_id = "after-poll"
        app.auto_poll_after_id = "after-auto"
        app.bootstrap_poll_after_id = "after-bootstrap"
        app.logs: list[str] = []
        app._append_log = lambda line: app.logs.append(line)

        app._on_close_requested()

        self.assertTrue(app.close_requested)
        self.assertIn("UI close requested", app.logs[0])
        self.assertEqual(
            app.root.after_cancel_calls,
            ["after-ui", "after-poll", "after-auto", "after-bootstrap"],
        )
        self.assertEqual(app.root.destroy_count, 1)
        self.assertIsNone(app.ui_callback_after_id)
        self.assertIsNone(app.poll_debounce_after_id)
        self.assertIsNone(app.auto_poll_after_id)
        self.assertIsNone(app.bootstrap_poll_after_id)

    def test_on_root_destroy_logs_only_for_root_widget(self) -> None:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.root = _FakeRoot()
        app.close_requested = False
        app.ui_callback_after_id = None
        app.poll_debounce_after_id = None
        app.auto_poll_after_id = None
        app.bootstrap_poll_after_id = None
        app.logs: list[str] = []
        app._append_log = lambda line: app.logs.append(line)

        child_event = type("Event", (), {"widget": object()})()
        root_event = type("Event", (), {"widget": app.root})()

        app._on_root_destroy(child_event)
        app._on_root_destroy(root_event)

        self.assertEqual(len(app.logs), 1)
        self.assertIn("UI root destroy event", app.logs[0])
        self.assertIn("root_exists=yes", app.logs[0])

    def test_run_cleans_up_after_callbacks_after_mainloop_returns(self) -> None:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.root = _FakeRoot()
        app.runtime_session_id = "session-123"
        app.close_requested = False
        app.ui_callback_after_id = "after-ui"
        app.poll_debounce_after_id = None
        app.auto_poll_after_id = "after-auto"
        app.bootstrap_poll_after_id = None
        app.logs: list[str] = []
        app._append_log = lambda line: app.logs.append(line)

        app.run()

        self.assertEqual(app.root.mainloop_count, 1)
        self.assertIn("UI mainloop starting", app.logs[0])
        self.assertIn("pending=ui,auto", app.logs[0])
        self.assertIn("session=session-123", app.logs[0])
        self.assertIn("UI mainloop exited without close request", app.logs[-1])
        self.assertIn("root_exists=yes", app.logs[-1])
        self.assertEqual(app.root.after_cancel_calls, ["after-ui", "after-auto"])
        self.assertIsNone(app.ui_callback_after_id)
        self.assertIsNone(app.auto_poll_after_id)

    def test_run_logs_mainloop_exit_after_close_request(self) -> None:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.root = _FakeRoot()
        app.close_requested = True
        app.ui_callback_after_id = None
        app.poll_debounce_after_id = None
        app.auto_poll_after_id = None
        app.bootstrap_poll_after_id = None
        app.logs: list[str] = []
        app._append_log = lambda line: app.logs.append(line)

        app.run()

        self.assertIn("UI mainloop exited after close request", app.logs[-1])
        self.assertIn("close_requested=True", app.logs[-1])

    def test_ui_callback_queue_runs_worker_results_on_main_thread(self) -> None:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.root = _FakeRoot()
        app.ui_callback_queue = SimpleQueue()
        app.ui_callback_after_id = None
        app.status_text = _FakeVar("idle")

        app._schedule_ui_callback_drain(15)
        app._dispatch_to_ui(lambda: app.status_text.set("queued-result"))

        self.assertEqual(app.status_text.get(), "idle")
        self.assertEqual(len(app.root.after_calls), 1)
        self.assertEqual(app.root.after_calls[0][0], 15)

        drain_callback = app.root.after_calls[0][1]
        drain_callback()

        self.assertEqual(app.status_text.get(), "queued-result")
        self.assertEqual(app.ui_callback_after_id, "after-2")

    def test_sync_initial_live_jobs_refreshes_summary_preview_and_bootstrap_when_empty(self) -> None:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.auto_poll_enabled = _FakeVar(True)
        app.bridge = _FakeBridge([], has_live_tools=True)
        app.INITIAL_LIVE_SYNC_TIMEOUT_SECONDS = 0.01
        app.status_text = _FakeVar()
        app.bridge_activity_error = "stale"
        app.bootstrap_visual_generation_requested = False
        app.schedule_delays: list[int] = []
        app.bridge_refresh_count = 0
        app.bootstrap_count = 0
        app.refresh_job_summary_count = 0
        app.refresh_asset_preview_count = 0
        app.cancel_bootstrap_count = 0
        app.logs: list[str] = []

        app._append_log = lambda line: app.logs.append(line)
        app._refresh_job_summary = lambda: setattr(app, "refresh_job_summary_count", app.refresh_job_summary_count + 1)
        app._refresh_asset_preview = lambda: setattr(app, "refresh_asset_preview_count", app.refresh_asset_preview_count + 1)
        app._schedule_auto_poll = lambda delay_ms=3000: app.schedule_delays.append(delay_ms)
        app._refresh_bridge_activity_text = lambda: setattr(app, "bridge_refresh_count", app.bridge_refresh_count + 1)
        app._maybe_bootstrap_server_visuals = lambda: setattr(app, "bootstrap_count", app.bootstrap_count + 1)
        app._cancel_bootstrap_poll = lambda: setattr(app, "cancel_bootstrap_count", app.cancel_bootstrap_count + 1)

        result = app._sync_initial_live_jobs()

        self.assertTrue(result)
        self.assertEqual(app.status_text.get(), "PixelLab sync complete: 0 jobu")
        self.assertEqual(app.bridge_activity_error, "")
        self.assertEqual(app.refresh_job_summary_count, 1)
        self.assertEqual(app.refresh_asset_preview_count, 1)
        self.assertEqual(app.bootstrap_count, 1)
        self.assertEqual(app.bridge_refresh_count, 0)
        self.assertEqual(app.schedule_delays, [500])
        self.assertIn("Initial PixelLab sync: 0 tracked", app.logs[0])

    def test_sync_initial_live_jobs_bootstraps_tileset_when_only_character_jobs_exist(self) -> None:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.auto_poll_enabled = _FakeVar(True)
        app.bridge = _FakeBridge(
            [
                PixelLabJob(
                    job_id="char-1",
                    job_type="character",
                    label="Character queued",
                    prompt="graph navigator operator",
                    status="ready",
                    source="mcp",
                    preview_url="https://example.invalid/char.png",
                )
            ],
            has_live_tools=True,
        )
        app.INITIAL_LIVE_SYNC_TIMEOUT_SECONDS = 0.01
        app.status_text = _FakeVar()
        app.bridge_activity_error = "stale"
        app.bootstrap_visual_generation_requested = False
        app.refresh_job_summary_count = 0
        app.refresh_asset_preview_count = 0
        app.bootstrap_count = 0
        app.bridge_refresh_count = 0
        app.logs: list[str] = []

        app._append_log = lambda line: app.logs.append(line)
        app._refresh_job_summary = lambda: setattr(app, "refresh_job_summary_count", app.refresh_job_summary_count + 1)
        app._refresh_asset_preview = lambda: setattr(app, "refresh_asset_preview_count", app.refresh_asset_preview_count + 1)
        app._refresh_bridge_activity_text = lambda: setattr(app, "bridge_refresh_count", app.bridge_refresh_count + 1)
        app._schedule_auto_poll = lambda delay_ms=3000: None
        app._cancel_bootstrap_poll = lambda: None
        app._maybe_bootstrap_server_visuals = lambda: setattr(app, "bootstrap_count", app.bootstrap_count + 1)

        result = app._sync_initial_live_jobs()

        self.assertTrue(result)
        self.assertEqual(app.bootstrap_count, 1)
        self.assertEqual(app.refresh_job_summary_count, 1)
        self.assertEqual(app.refresh_asset_preview_count, 1)
        self.assertEqual(app.bridge_refresh_count, 0)

    def test_sync_initial_live_jobs_does_not_bootstrap_when_auto_poll_is_disabled(self) -> None:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.auto_poll_enabled = _FakeVar(False)
        app.bridge = _FakeBridge([], has_live_tools=True)
        app.INITIAL_LIVE_SYNC_TIMEOUT_SECONDS = 0.01
        app.status_text = _FakeVar()
        app.bridge_activity_error = "stale"
        app.bootstrap_visual_generation_requested = False
        app.schedule_delays: list[int] = []
        app.bridge_refresh_count = 0
        app.bootstrap_count = 0
        app.refresh_job_summary_count = 0
        app.refresh_asset_preview_count = 0
        app.cancel_bootstrap_count = 0
        app.logs: list[str] = []

        app._append_log = lambda line: app.logs.append(line)
        app._refresh_job_summary = lambda: setattr(app, "refresh_job_summary_count", app.refresh_job_summary_count + 1)
        app._refresh_asset_preview = lambda: setattr(app, "refresh_asset_preview_count", app.refresh_asset_preview_count + 1)
        app._schedule_auto_poll = lambda delay_ms=3000: app.schedule_delays.append(delay_ms)
        app._refresh_bridge_activity_text = lambda: setattr(app, "bridge_refresh_count", app.bridge_refresh_count + 1)
        app._maybe_bootstrap_server_visuals = lambda: setattr(app, "bootstrap_count", app.bootstrap_count + 1)
        app._cancel_bootstrap_poll = lambda: setattr(app, "cancel_bootstrap_count", app.cancel_bootstrap_count + 1)

        result = app._sync_initial_live_jobs()

        self.assertTrue(result)
        self.assertEqual(app.bootstrap_count, 0)
        self.assertEqual(app.bridge_refresh_count, 1)
        self.assertEqual(app.schedule_delays, [])


    def test_sync_initial_live_jobs_times_out_without_blocking_startup(self) -> None:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.auto_poll_enabled = _FakeVar(False)
        app.bridge = _FakeBridge([], has_live_tools=True)
        app.INITIAL_LIVE_SYNC_TIMEOUT_SECONDS = 0.01
        app.status_text = _FakeVar()
        app.bridge_activity_error = ""
        app.logs: list[str] = []
        app._append_log = lambda line: app.logs.append(line)

        with mock.patch("projects.shumilek_ui.main.threading.Thread", _HangingThread):
            result = app._sync_initial_live_jobs()

        self.assertFalse(result)
        self.assertEqual(app.bridge_activity_error, "Initial PixelLab sync timed out")
        self.assertEqual(app.status_text.get(), "Initial PixelLab sync timed out, polling in background...")
        self.assertIn("Initial PixelLab sync timed out", app.logs[0])

    def test_maybe_bootstrap_server_visuals_queues_initial_requests_and_poll(self) -> None:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.auto_poll_enabled = _FakeVar(True)
        app.bridge = _FakeBridge(
            [],
            has_live_tools=True,
            tool_bindings={
                "create_character": lambda **_kwargs: None,
                "create_topdown_tileset": lambda **_kwargs: None,
            },
        )
        app.root = _FakeRoot()
        app.status_text = _FakeVar()
        app.bridge_action_in_progress = set()
        app.poll_debounce_after_id = None
        app.bootstrap_poll_after_id = None
        app.bootstrap_visual_generation_requested = False
        app.bootstrap_poll_attempts_remaining = 0
        app.log_lines = []
        app.queued: list[str] = []
        app.cleared_message = ""

        def queue_character() -> None:
            app.queued.append("character")

        def queue_tileset() -> None:
            app.queued.append("tileset")

        def append_log(line: str) -> None:
            app.log_lines.append(line)

        def clear_server_visuals(message: str) -> None:
            app.cleared_message = message

        app._queue_character = queue_character
        app._queue_tileset = queue_tileset
        app._append_log = append_log
        app._clear_server_visuals = clear_server_visuals

        app._maybe_bootstrap_server_visuals()

        self.assertEqual(app.queued, ["character", "tileset"])
        self.assertTrue(app.bootstrap_visual_generation_requested)
        self.assertEqual(app.root.after_calls[0][0], 1200)
        self.assertIn("Bootstrapping PixelLab visuals", app.status_text.get())
        self.assertIn("Bootstrapping initial PixelLab visuals", app.log_lines[0])
        self.assertIn("PixelLab bootstrap bezi", app.cleared_message)

    def test_maybe_bootstrap_server_visuals_queues_only_tileset_when_character_jobs_already_exist(self) -> None:
        jobs = [
            PixelLabJob(
                job_id="char-1",
                job_type="character",
                label="Character queued",
                prompt="graph navigator operator",
                status="ready",
                source="mcp",
                preview_url="https://example.invalid/char.png",
            )
        ]
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.auto_poll_enabled = _FakeVar(True)
        app.bridge = _FakeBridge(
            jobs,
            has_live_tools=True,
            tool_bindings={
                "create_character": lambda **_kwargs: None,
                "create_topdown_tileset": lambda **_kwargs: None,
            },
        )
        app.root = _FakeRoot()
        app.status_text = _FakeVar()
        app.bridge_action_in_progress = set()
        app.poll_debounce_after_id = None
        app.bootstrap_poll_after_id = None
        app.bootstrap_visual_generation_requested = False
        app.bootstrap_poll_attempts_remaining = 0
        app.log_lines = []
        app.queued: list[str] = []
        app.cleared_message = ""

        app._queue_character = lambda: app.queued.append("character")
        app._queue_tileset = lambda: app.queued.append("tileset")
        app._append_log = lambda line: app.log_lines.append(line)
        app._clear_server_visuals = lambda message: setattr(app, "cleared_message", message)

        app._maybe_bootstrap_server_visuals()

        self.assertEqual(app.queued, ["tileset"])
        self.assertTrue(app.bootstrap_visual_generation_requested)
        self.assertEqual(app.root.after_calls[0][0], 1200)

    def test_maybe_bootstrap_server_visuals_skips_queueing_when_auto_poll_is_disabled(self) -> None:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.auto_poll_enabled = _FakeVar(False)
        app.bridge = _FakeBridge(
            [],
            has_live_tools=True,
            tool_bindings={
                "create_character": lambda **_kwargs: None,
                "create_topdown_tileset": lambda **_kwargs: None,
            },
        )
        app.root = _FakeRoot()
        app.bootstrap_visual_generation_requested = True
        app.bootstrap_poll_after_id = "after-bootstrap"
        app.queued: list[str] = []

        app._queue_character = lambda: app.queued.append("character")
        app._queue_tileset = lambda: app.queued.append("tileset")

        app._maybe_bootstrap_server_visuals()

        self.assertEqual(app.queued, [])
        self.assertFalse(app.bootstrap_visual_generation_requested)
        self.assertEqual(app.root.after_cancel_calls, ["after-bootstrap"])

    def test_apply_poll_jobs_result_reschedules_bootstrap_poll_while_waiting_for_ready_asset(self) -> None:
        app = self._make_app()
        app.bootstrap_visual_generation_requested = True
        jobs = [
            PixelLabJob(
                job_id="job-1",
                job_type="character",
                label="Character queued",
                prompt="forest spirit archivist",
                status="processing",
                source="mcp",
            )
        ]

        app._apply_poll_jobs_result(jobs, "", 5)

        self.assertEqual(app._schedule_bootstrap_poll_called, [2500])
        self.assertEqual(app._cancel_bootstrap_poll_called, 0)

    def test_apply_poll_jobs_result_stops_bootstrap_when_ready_asset_arrives(self) -> None:
        app = self._make_app()
        app.bootstrap_visual_generation_requested = True
        jobs = [
            PixelLabJob(
                job_id="job-1",
                job_type="tileset",
                label="Tileset queued",
                prompt="dark topology grid",
                status="ready",
                source="mcp",
                preview_url="https://example.com/preview.png",
            )
        ]

        app._apply_poll_jobs_result(jobs, "", 5)

        self.assertFalse(app.bootstrap_visual_generation_requested)
        self.assertEqual(app._schedule_bootstrap_poll_called, [])
        self.assertEqual(app._cancel_bootstrap_poll_called, 1)

    def test_apply_poll_jobs_result_keeps_bootstrap_running_when_only_ready_character_arrives(self) -> None:
        app = self._make_app()
        app.bootstrap_visual_generation_requested = True
        jobs = [
            PixelLabJob(
                job_id="job-1",
                job_type="character",
                label="Character queued",
                prompt="forest spirit archivist",
                status="ready",
                source="mcp",
                preview_url="https://example.com/preview.png",
            )
        ]

        app._apply_poll_jobs_result(jobs, "", 5)

        self.assertTrue(app.bootstrap_visual_generation_requested)
        self.assertEqual(app._schedule_bootstrap_poll_called, [2500])
        self.assertEqual(app._cancel_bootstrap_poll_called, 0)

    def test_refresh_asset_preview_renders_processing_feed_when_jobs_are_in_flight(self) -> None:
        jobs = [
            PixelLabJob(
                job_id="char-1",
                job_type="character",
                label="Character queued",
                prompt="forest spirit",
                status="processing",
                source="mcp",
            ),
        ]
        app = self._make_preview_app(jobs)

        app._refresh_asset_preview()

        self.assertEqual(app.asset_source_badge_text.get(), "SOURCE: live processing")
        self.assertEqual(app.asset_status_text.get(), "Character queued | processing")
        self.assertIn("Live jobs: 1", app.asset_meta_text.get())
        self.assertEqual(app.processing_visual_calls, ["char-1"])
        self.assertEqual(app.cleared_preview_label, "No preview yet")

    def test_on_asset_history_filter_changed_persists_and_refreshes(self) -> None:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.asset_history_job_id = "tile-1"
        app.persist_count = 0
        app.refresh_count = 0

        def persist_ui_preferences() -> None:
            app.persist_count += 1

        def refresh_asset_preview() -> None:
            app.refresh_count += 1

        app._persist_ui_preferences = persist_ui_preferences
        app._refresh_asset_preview = refresh_asset_preview

        app._on_asset_history_filter_changed()

        self.assertEqual(app.persist_count, 1)
        self.assertEqual(app.refresh_count, 1)
        self.assertEqual(app.asset_history_job_id, "")

    def test_on_auto_poll_interval_changed_normalizes_persists_and_reschedules(self) -> None:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.auto_poll_enabled = _FakeVar(True)
        app.auto_poll_seconds = _FakeVar("99")
        app.status_text = _FakeVar()
        app.persist_count = 0
        app.cancel_count = 0
        app.schedule_delays: list[int] = []

        def persist_ui_preferences() -> None:
            app.persist_count += 1

        def cancel_auto_poll() -> None:
            app.cancel_count += 1

        def schedule_auto_poll(delay_ms: int = 3000) -> None:
            app.schedule_delays.append(delay_ms)

        app._persist_ui_preferences = persist_ui_preferences
        app._cancel_auto_poll = cancel_auto_poll
        app._schedule_auto_poll = schedule_auto_poll
        app._refresh_bridge_activity_text = lambda: None

        app._on_auto_poll_interval_changed()

        self.assertEqual(app.auto_poll_seconds.get(), 30)
        self.assertEqual(app.persist_count, 1)
        self.assertEqual(app.cancel_count, 1)
        self.assertEqual(app.schedule_delays, [30000])
        self.assertEqual(app.status_text.get(), "Auto-poll interval set to 30s")

    def test_on_auto_poll_toggle_enables_and_schedules_polling(self) -> None:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.auto_poll_enabled = _FakeVar(True)
        app.bridge_activity_error = "stale error"
        app.status_text = _FakeVar()
        app.persist_count = 0
        app.schedule_delays: list[int] = []

        def persist_ui_preferences() -> None:
            app.persist_count += 1

        def schedule_auto_poll(delay_ms: int = 3000) -> None:
            app.schedule_delays.append(delay_ms)

        app._persist_ui_preferences = persist_ui_preferences
        app._schedule_auto_poll = schedule_auto_poll
        app._cancel_auto_poll = lambda: None
        app._refresh_bridge_activity_text = lambda: None

        app._on_auto_poll_toggle()

        self.assertEqual(app.persist_count, 1)
        self.assertEqual(app.bridge_activity_error, "")
        self.assertEqual(app.schedule_delays, [500])
        self.assertEqual(app.status_text.get(), "Auto-poll enabled")

    def test_on_auto_poll_toggle_disables_and_refreshes_bridge_state(self) -> None:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.auto_poll_enabled = _FakeVar(False)
        app.status_text = _FakeVar()
        app.persist_count = 0
        app.cancel_count = 0
        app.cancel_bootstrap_count = 0
        app.bridge_refresh_count = 0
        app.bootstrap_visual_generation_requested = True

        def persist_ui_preferences() -> None:
            app.persist_count += 1

        def cancel_auto_poll() -> None:
            app.cancel_count += 1

        def cancel_bootstrap_poll() -> None:
            app.cancel_bootstrap_count += 1

        def refresh_bridge_activity_text() -> None:
            app.bridge_refresh_count += 1

        app._persist_ui_preferences = persist_ui_preferences
        app._cancel_auto_poll = cancel_auto_poll
        app._cancel_bootstrap_poll = cancel_bootstrap_poll
        app._refresh_bridge_activity_text = refresh_bridge_activity_text
        app._schedule_auto_poll = lambda _delay=3000: None

        app._on_auto_poll_toggle()

        self.assertEqual(app.persist_count, 1)
        self.assertFalse(app.bootstrap_visual_generation_requested)
        self.assertEqual(app.cancel_bootstrap_count, 1)
        self.assertEqual(app.cancel_count, 1)
        self.assertEqual(app.bridge_refresh_count, 1)
        self.assertEqual(app.status_text.get(), "Auto-poll paused")

    def test_queue_character_stylizes_prompt_before_sending_to_server(self) -> None:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.character_prompt = _FakeVar("graph navigator operator")
        app.server_style_preset = _FakeVar("graph_workbench")
        app.bridge_activity_error = ""
        app.status_text = _FakeVar()
        app.captured_thread_args: tuple[object, ...] | None = None

        def begin_bridge_action(_action_key: str) -> int:
            return 7

        class _FakeThread:
            def __init__(self, *, target: object, args: tuple[object, ...], daemon: bool) -> None:
                del target, daemon
                app.captured_thread_args = args

            def start(self) -> None:
                return None

        app._begin_bridge_action = begin_bridge_action

        with mock.patch("projects.shumilek_ui.main.threading.Thread", _FakeThread):
            app._queue_character()

        self.assertIsNotNone(app.captured_thread_args)
        self.assertIn("graph navigator operator", str(app.captured_thread_args[0]))
        self.assertIn("dark graph-workbench operator portrait", str(app.captured_thread_args[0]))
        self.assertEqual(app.captured_thread_args[1], 7)

    def test_queue_tileset_stylizes_both_prompts_before_sending_to_server(self) -> None:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.tileset_lower = _FakeVar("dark topology grid")
        app.tileset_upper = _FakeVar("cyan teal node lattice")
        app.server_style_preset = _FakeVar("graph_workbench")
        app.bridge_activity_error = ""
        app.status_text = _FakeVar()
        app.captured_thread_args: tuple[object, ...] | None = None

        def begin_bridge_action(_action_key: str) -> int:
            return 9

        class _FakeThread:
            def __init__(self, *, target: object, args: tuple[object, ...], daemon: bool) -> None:
                del target, daemon
                app.captured_thread_args = args

            def start(self) -> None:
                return None

        app._begin_bridge_action = begin_bridge_action

        with mock.patch("projects.shumilek_ui.main.threading.Thread", _FakeThread):
            app._queue_tileset()

        self.assertIsNotNone(app.captured_thread_args)
        self.assertIn("charcoal topology floor", str(app.captured_thread_args[0]))
        self.assertIn("luminous node clusters", str(app.captured_thread_args[1]))
        self.assertEqual(app.captured_thread_args[2], 9)

    def test_persist_ui_preferences_deduplicates_repeated_save_errors(self) -> None:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.auto_poll_enabled = _FakeVar(True)
        app.auto_poll_seconds = _FakeVar(7)
        app.asset_history_filter = _FakeVar("tileset")
        app.server_style_preset = _FakeVar("control_room_lattice")
        app.ui_settings_save_error = ""
        app.status_text = _FakeVar()
        app.log_lines: list[str] = []

        def append_log(line: str) -> None:
            app.log_lines.append(line)

        app._append_log = append_log

        with mock.patch("projects.shumilek_ui.main.save_ui_settings", side_effect=OSError("disk full")):
            app._persist_ui_preferences()
            app._persist_ui_preferences()

        self.assertEqual(app.ui_settings_save_error, "disk full")
        self.assertEqual(app.status_text.get(), "Nepodarilo se ulozit UI nastaveni")
        self.assertEqual(app.log_lines, ["15:06  UI settings save failed: disk full"])

    def test_persist_ui_preferences_clears_error_after_success(self) -> None:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.auto_poll_enabled = _FakeVar(False)
        app.auto_poll_seconds = _FakeVar(3)
        app.asset_history_filter = _FakeVar("all")
        app.server_style_preset = _FakeVar("graph_workbench")
        app.ui_settings_save_error = "disk full"
        app.status_text = _FakeVar()
        app._append_log = lambda _line: None

        with mock.patch("projects.shumilek_ui.main.save_ui_settings") as mocked_save:
            app._persist_ui_preferences()

        self.assertEqual(app.ui_settings_save_error, "")
        mocked_save.assert_called_once_with(
            {
                "auto_poll_enabled": False,
                "auto_poll_seconds": 3,
                "asset_history_filter": "all",
                "server_style_preset": "graph_workbench",
            }
        )

    def test_append_log_writes_to_external_trace_file(self) -> None:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.log_lines = []
        app.external_log_path = Path(tempfile.gettempdir()) / "shumilek_test_trace.log"
        app._refresh_log_view = lambda: None

        try:
            if app.external_log_path.exists():
                app.external_log_path.unlink()
            PixelWorkspaceApp._append_log(app, "15:08  External trace smoke test")
            self.assertTrue(app.external_log_path.exists())
            self.assertEqual(app.log_lines, ["15:08  External trace smoke test"])
            self.assertIn("15:08  External trace smoke test", app.external_log_path.read_text(encoding="utf-8"))
        finally:
            if app.external_log_path.exists():
                app.external_log_path.unlink()

    def test_append_log_ignores_external_trace_write_failures(self) -> None:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.log_lines = []
        app.external_log_path = Path(tempfile.gettempdir()) / "shumilek_test_trace_fail.log"
        app._refresh_log_view = lambda: None

        with mock.patch.object(Path, "open", side_effect=OSError("disk full")):
            PixelWorkspaceApp._append_log(app, "15:08  External trace fallback")

        self.assertEqual(app.log_lines, ["15:08  External trace fallback"])

    def test_on_server_style_preset_changed_persists_and_refreshes(self) -> None:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.server_style_preset = _FakeVar("dark_network_map")
        app.server_style_preset_text = _FakeVar()
        app.status_text = _FakeVar()
        app.asset_history_job_id = "graph-job"
        app.persist_count = 0
        app.refresh_count = 0

        app._persist_ui_preferences = lambda: setattr(app, "persist_count", app.persist_count + 1)
        app._refresh_asset_preview = lambda: setattr(app, "refresh_count", app.refresh_count + 1)

        app._on_server_style_preset_changed()

        self.assertEqual(app.server_style_preset.get(), "dark_network_map")
        self.assertEqual(app.server_style_preset_text.get(), "Dark Network Map")
        self.assertEqual(app.asset_history_job_id, "")
        self.assertEqual(app.persist_count, 1)
        self.assertEqual(app.refresh_count, 1)
        self.assertIn("Dark Network Map", app.status_text.get())

    def test_on_server_style_preset_changed_switches_preview_to_matching_ready_asset(self) -> None:
        jobs = [
            PixelLabJob(
                job_id="graph-1",
                job_type="character",
                label="Character",
                prompt="graph navigator operator, style preset: graph-workbench, dark graph-workbench operator portrait",
                status="ready",
                source="mcp",
                preview_url="https://example.invalid/graph.png",
            ),
            PixelLabJob(
                job_id="map-1",
                job_type="character",
                label="Character",
                prompt="network cartographer, style preset: dark-network-map, dark network cartographer",
                status="ready",
                source="mcp",
                preview_url="https://example.invalid/map.png",
            ),
        ]
        app = self._make_preview_app(jobs, selected_job_id="graph-1")
        app.server_style_preset = _FakeVar("dark_network_map")
        app.server_style_preset_text = _FakeVar("Graph Workbench")
        app.status_text = _FakeVar()
        app.persist_count = 0
        app._persist_ui_preferences = lambda: setattr(app, "persist_count", app.persist_count + 1)

        app._on_server_style_preset_changed()

        self.assertEqual(app.persist_count, 1)
        self.assertEqual(app.server_style_preset_text.get(), "Dark Network Map")
        self.assertEqual(app.asset_history_job_id, "map-1")
        self.assertEqual(app.started_preview_url, "https://example.invalid/map.png")
        self.assertEqual(app.asset_status_text.get(), "Character | ready")
        self.assertIn("Dark Network Map", app.status_text.get())

    def test_apply_seed_live_jobs_promotes_ready_tileset_when_user_has_not_selected_asset(self) -> None:
        jobs = [
            PixelLabJob(
                job_id="char-1",
                job_type="character",
                label="Character",
                prompt="graph navigator operator",
                status="ready",
                source="mcp",
                preview_url="https://example.invalid/char.png",
            ),
            PixelLabJob(
                job_id="tile-1",
                job_type="tileset",
                label="Tileset",
                prompt="dark topology grid",
                status="ready",
                source="mcp",
                preview_url="https://example.invalid/tile.png",
                download_url="https://example.invalid/tile.png",
            ),
        ]
        app = self._make_preview_app(jobs, selected_job_id="char-1")
        app.active_visual_job_type = "character"
        app.status_text = _FakeVar()
        app.refresh_job_summary_count = 0
        app._refresh_job_summary = lambda: setattr(app, "refresh_job_summary_count", app.refresh_job_summary_count + 1)

        app._apply_seed_live_jobs(jobs, promote_tileset=True)

        self.assertEqual(app.refresh_job_summary_count, 1)
        self.assertEqual(app.asset_history_job_id, "tile-1")
        self.assertEqual(app.active_visual_job_type, "tileset")
        self.assertEqual(app.started_preview_url, "https://example.invalid/tile.png")
        self.assertEqual(app.status_text.get(), "PixelLab seed ready: 2 jobu")

    def test_apply_seed_live_jobs_does_not_override_manual_asset_selection(self) -> None:
        jobs = [
            PixelLabJob(
                job_id="char-1",
                job_type="character",
                label="Character",
                prompt="graph navigator operator",
                status="ready",
                source="mcp",
                preview_url="https://example.invalid/char.png",
            ),
            PixelLabJob(
                job_id="tile-1",
                job_type="tileset",
                label="Tileset",
                prompt="dark topology grid",
                status="ready",
                source="mcp",
                preview_url="https://example.invalid/tile.png",
                download_url="https://example.invalid/tile.png",
            ),
        ]
        app = self._make_preview_app(jobs, selected_job_id="char-1")
        app.active_visual_job_type = "character"
        app.asset_history_user_selected = True
        app.status_text = _FakeVar()
        app.refresh_job_summary_count = 0
        app._refresh_job_summary = lambda: setattr(app, "refresh_job_summary_count", app.refresh_job_summary_count + 1)

        app._apply_seed_live_jobs(jobs, promote_tileset=True)

        self.assertEqual(app.refresh_job_summary_count, 0)
        self.assertEqual(app.asset_history_job_id, "char-1")
        self.assertEqual(app.active_visual_job_type, "character")
        self.assertIsNone(app.started_preview_url)

    def test_refresh_job_summary_updates_tracked_jobs_list_and_detail(self) -> None:
        jobs = [
            PixelLabJob(job_id="job-1", job_type="character", label="Character queued", prompt="forest spirit archivist", status="queued", source="mcp"),
            PixelLabJob(job_id="job-2", job_type="tileset", label="Tileset ready", prompt="mossy floor", status="ready", source="mcp", detail="48x48"),
        ]
        app = self._make_tracked_jobs_app(jobs)

        app._refresh_job_summary()

        self.assertEqual(app.job_summary_text.get(), "Tracked: 2 | Ready: 1 | Active: 1")
        self.assertEqual(app.tracked_job_ids, ["job-1", "job-2"])
        self.assertEqual(app.tracked_job_id, "job-1")
        self.assertEqual(app.tracked_job_listbox.selected_index, 0)
        self.assertEqual(app.tracked_job_listbox.items, ["[queued] character | forest spirit archivist", "[ready] tileset | mossy floor"])
        self.assertEqual(app.tracked_job_listbox.item_options[0]["foreground"], app.STATUS_TONE_COLORS["busy"])
        self.assertEqual(app.tracked_job_listbox.item_options[1]["foreground"], app.STATUS_TONE_COLORS["ready"])
        self.assertEqual(app.tracked_job_detail_text.get(), "Type: character\nStatus: queued\nSource: mcp\nPrompt: forest spirit archivist")

    def test_tracked_job_tone_maps_status_groups(self) -> None:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)

        self.assertEqual(app._tracked_job_tone("queued"), "busy")
        self.assertEqual(app._tracked_job_tone("processing"), "busy")
        self.assertEqual(app._tracked_job_tone("ready"), "ready")
        self.assertEqual(app._tracked_job_tone("failed"), "alert")
        self.assertEqual(app._tracked_job_tone("unknown"), "idle")

    def test_on_tracked_job_select_updates_selected_node_and_detail(self) -> None:
        jobs = [
            PixelLabJob(job_id="job-1", job_type="character", label="Character queued", prompt="forest spirit archivist", status="queued", source="mcp"),
            PixelLabJob(job_id="job-2", job_type="tileset", label="Tileset ready", prompt="mossy floor", status="ready", source="mcp", detail="48x48"),
        ]
        app = self._make_tracked_jobs_app(jobs)
        app._refresh_tracked_jobs(jobs)
        app.tracked_job_listbox.selection_set(1)

        app._on_tracked_job_select(None)

        self.assertEqual(app.tracked_job_id, "job-2")
        self.assertEqual(app.selected_node.get(), "Tileset ready")
        self.assertEqual(app.tracked_job_detail_text.get(), "Type: tileset\nStatus: ready\nSource: mcp\nPrompt: mossy floor\nDetail: 48x48")

    def test_on_tracked_job_select_truncates_long_detail_fields(self) -> None:
        long_prompt = "dark topology grid with layered biomes and route overlays " * 4
        long_detail = "tile atlas diagnostic line with repeated metadata " * 4
        long_preview_url = "https://example.invalid/assets/previews/world/" + ("segment-" * 12) + "preview.png"
        long_download_url = "https://example.invalid/assets/downloads/world/" + ("segment-" * 12) + "download.png"
        jobs = [
            PixelLabJob(
                job_id="job-1",
                job_type="tileset",
                label="Tileset ready",
                prompt=long_prompt,
                status="ready",
                source="mcp",
                detail=long_detail,
                preview_url=long_preview_url,
                download_url=long_download_url,
            ),
        ]
        app = self._make_tracked_jobs_app(jobs)
        app._refresh_tracked_jobs(jobs)
        app.tracked_job_listbox.selection_set(0)

        app._on_tracked_job_select(None)

        detail_text = app.tracked_job_detail_text.get()
        self.assertIn("Prompt: ", detail_text)
        self.assertIn("Detail: ", detail_text)
        self.assertIn("Preview: ", detail_text)
        self.assertIn("Download: ", detail_text)
        self.assertIn("...", detail_text)
        self.assertNotIn(long_prompt, detail_text)
        self.assertNotIn(long_detail, detail_text)
        self.assertNotIn(long_preview_url, detail_text)
        self.assertNotIn(long_download_url, detail_text)

    def test_copy_tracked_job_detail_copies_full_untruncated_text(self) -> None:
        long_prompt = "dark topology grid with layered biomes and route overlays " * 4
        long_preview_url = "https://example.invalid/assets/previews/world/" + ("segment-" * 12) + "preview.png"
        jobs = [
            PixelLabJob(
                job_id="job-1",
                job_type="tileset",
                label="Tileset ready",
                prompt=long_prompt,
                status="ready",
                source="mcp",
                preview_url=long_preview_url,
            ),
        ]
        app = self._make_tracked_jobs_app(jobs)
        app._refresh_tracked_jobs(jobs)

        app._copy_tracked_job_detail()

        self.assertIn(long_prompt, app.root.clipboard_value)
        self.assertIn(long_preview_url, app.root.clipboard_value)
        self.assertEqual(app.root.clipboard_clear_count, 1)
        self.assertEqual(app.root.update_idletasks_count, 1)
        self.assertEqual(app.status_text.get(), "Tracked job detail copied to clipboard")

    def test_copy_tracked_job_detail_reports_when_nothing_is_selected(self) -> None:
        app = self._make_tracked_jobs_app([])
        app.tracked_job_id = ""
        app.tracked_job_full_detail_text = ""

        app._copy_tracked_job_detail()

        self.assertEqual(app.root.clipboard_value, "")
        self.assertEqual(app.status_text.get(), "Neni co kopirovat pro tracked job")

    def test_refresh_asset_preview_clears_state_when_filter_has_no_ready_assets(self) -> None:
        jobs = [
            PixelLabJob(job_id="char-1", job_type="character", label="Character", prompt="forest spirit", status="ready", source="mcp"),
        ]
        app = self._make_preview_app(jobs, history_filter="tileset")

        app._refresh_asset_preview()

        self.assertEqual(app.asset_source_badge_text.get(), "SOURCE: waiting")
        self.assertEqual(app.asset_history_filter_labels["all"].get(), "All (1)")
        self.assertEqual(app.asset_history_filter_labels["character"].get(), "Characters (1)")
        self.assertEqual(app.asset_history_filter_labels["tileset"].get(), "Tilesets (0)")
        self.assertEqual(app.asset_history_job_id, "")
        self.assertEqual(app.preview_asset_url, "")
        self.assertEqual(app.download_asset_url, "")
        self.assertEqual(app.asset_status_text.get(), "Preview se ukaze po dokonceni live jobu.")
        self.assertEqual(app.asset_meta_text.get(), "Zatim neni k dispozici zadny hotovy asset.")
        self.assertEqual(app.asset_link_text.get(), "")
        self.assertEqual(app.asset_cache_text.get(), "Cache: zatim prazdna")
        self.assertEqual(app.cleared_preview_label, "No preview yet")
        self.assertIsNone(app.started_preview_url)

    def test_refresh_asset_preview_selects_filtered_ready_asset_and_starts_preview_load(self) -> None:
        jobs = [
            PixelLabJob(job_id="char-1", job_type="character", label="Character", prompt="forest spirit", status="ready", source="mcp"),
            PixelLabJob(
                job_id="tile-1",
                job_type="tileset",
                label="Tileset",
                prompt="mossy floor",
                status="ready",
                source="mcp",
                asset_name="mossy_floor_sheet.png",
                detail="48x48",
                download_url="https://example.invalid/mossy_floor.png",
            ),
        ]
        app = self._make_preview_app(jobs, history_filter="tileset", selected_job_id="missing")

        app._refresh_asset_preview()

        self.assertEqual(app.asset_source_badge_text.get(), "SOURCE: live ready")
        self.assertEqual(app.asset_history_job_id, "tile-1")
        self.assertEqual(app.asset_history_ids, ["tile-1"])
        self.assertEqual(app.asset_history_listbox.items, ["[ready] mossy_floor_sheet.png"])
        self.assertEqual(app.asset_history_listbox.selected_index, 0)
        self.assertEqual(app.asset_status_text.get(), "Tileset | ready")
        self.assertEqual(app.asset_meta_text.get(), "Prompt: mossy floor\nName: mossy_floor_sheet.png\nDetail: 48x48")
        self.assertEqual(app.asset_link_text.get(), "Download: https://example.invalid/mossy_floor.png")
        self.assertEqual(app.asset_cache_text.get(), "Cache: asset jeste neni lokalne ulozen")
        self.assertEqual(app.started_preview_url, "https://example.invalid/mossy_floor.png")
        self.assertIsNone(app.cached_preview_path)
        self.assertIsNone(app.cached_download_path)

    def test_refresh_asset_preview_prefers_ready_asset_matching_selected_server_preset(self) -> None:
        jobs = [
            PixelLabJob(
                job_id="graph-1",
                job_type="character",
                label="Character",
                prompt="graph navigator operator, style preset: graph-workbench, dark graph-workbench operator portrait",
                status="ready",
                source="mcp",
                preview_url="https://example.invalid/graph.png",
            ),
            PixelLabJob(
                job_id="map-1",
                job_type="character",
                label="Character",
                prompt="network cartographer, style preset: dark-network-map, dark network cartographer",
                status="ready",
                source="mcp",
                preview_url="https://example.invalid/map.png",
            ),
        ]
        app = self._make_preview_app(jobs)
        app.server_style_preset.set("dark_network_map")

        app._refresh_asset_preview()

        self.assertEqual(app.asset_history_job_id, "map-1")
        self.assertEqual(app.started_preview_url, "https://example.invalid/map.png")
        self.assertEqual(app.asset_status_text.get(), "Character | ready")

    def test_refresh_asset_preview_auto_promotes_ready_tileset_over_stale_character_selection(self) -> None:
        jobs = [
            PixelLabJob(
                job_id="char-1",
                job_type="character",
                label="Character",
                prompt="graph navigator operator",
                status="ready",
                source="mcp",
                preview_url="https://example.invalid/char.png",
            ),
            PixelLabJob(
                job_id="tile-1",
                job_type="tileset",
                label="Tileset",
                prompt="dark topology grid, style preset: graph-workbench",
                status="ready",
                source="mcp",
                preview_url="https://example.invalid/tile.png",
            ),
        ]
        app = self._make_preview_app(jobs, selected_job_id="char-1")
        app.active_visual_job_type = "character"

        app._refresh_asset_preview()

        self.assertEqual(app.asset_history_job_id, "tile-1")
        self.assertEqual(app.started_preview_url, "https://example.invalid/tile.png")
        self.assertEqual(app.asset_status_text.get(), "Tileset | ready")
        self.assertIn("15:04  Auto-promoted preview from character to ready tileset", app.log_lines)

    def test_refresh_asset_preview_preserves_manual_character_selection_over_ready_tileset(self) -> None:
        jobs = [
            PixelLabJob(
                job_id="char-1",
                job_type="character",
                label="Character",
                prompt="graph navigator operator",
                status="ready",
                source="mcp",
                preview_url="https://example.invalid/char.png",
            ),
            PixelLabJob(
                job_id="tile-1",
                job_type="tileset",
                label="Tileset",
                prompt="dark topology grid, style preset: graph-workbench",
                status="ready",
                source="mcp",
                preview_url="https://example.invalid/tile.png",
            ),
        ]
        app = self._make_preview_app(jobs, selected_job_id="char-1")
        app.asset_history_user_selected = True

        app._refresh_asset_preview()

        self.assertEqual(app.asset_history_job_id, "char-1")
        self.assertEqual(app.started_preview_url, "https://example.invalid/char.png")
        self.assertEqual(app.asset_status_text.get(), "Character | ready")

    def test_refresh_asset_preview_reuses_loaded_image_without_restart(self) -> None:
        jobs = [
            PixelLabJob(
                job_id="tile-1",
                job_type="tileset",
                label="Tileset",
                prompt="mossy floor",
                status="ready",
                source="mcp",
                preview_url="https://example.invalid/mossy_floor_preview.png",
            ),
        ]
        app = self._make_preview_app(jobs)
        app.loaded_preview_url = "https://example.invalid/mossy_floor_preview.png"
        app.current_preview_image = object()

        app._refresh_asset_preview()

        self.assertEqual(app.asset_history_job_id, "tile-1")
        self.assertIsNone(app.started_preview_url)
        self.assertIsNone(app.cleared_preview_label)

    def test_refresh_asset_preview_considers_ready_assets_beyond_default_window(self) -> None:
        jobs = [
            PixelLabJob(
                job_id=f"char-{index}",
                job_type="character",
                label="Character",
                prompt=f"forest spirit {index}",
                status="ready",
                source="mcp",
                preview_url=f"https://example.invalid/char-{index}.png",
            )
            for index in range(6)
        ]
        jobs.append(
            PixelLabJob(
                job_id="tile-world",
                job_type="tileset",
                label="Tileset",
                prompt="dark topology grid, style preset: graph-workbench",
                status="ready",
                source="mcp",
                preview_url="https://example.invalid/world.png",
            )
        )
        app = self._make_preview_app(jobs)

        app._refresh_asset_preview()

        self.assertEqual(app.asset_history_job_id, "tile-world")
        self.assertEqual(app.started_preview_url, "https://example.invalid/world.png")
        self.assertEqual(app.asset_status_text.get(), "Tileset | ready")

    def test_apply_preview_load_uses_cached_file_path_for_photoimage(self) -> None:
        app = self._make_preview_loader_app()
        with tempfile.TemporaryDirectory() as temp_dir:
            cached_path = Path(temp_dir) / "preview.png"
            cached_path.write_bytes(b"png-bytes")
            image = object()
            with mock.patch("projects.shumilek_ui.main.tk.PhotoImage", return_value=image) as mocked_photo:
                app._apply_preview_load("https://example.invalid/live.png", 7, cached_path)

        mocked_photo.assert_called_once_with(file=str(cached_path))
        self.assertIs(app.current_preview_image, image)
        self.assertEqual(app.loaded_preview_url, "https://example.invalid/live.png")
        self.assertEqual(app.cached_preview_path, cached_path)
        self.assertEqual(app.cached_preview_source_url, "https://example.invalid/live.png")
        self.assertEqual(app.pending_preview_url, "")
        self.assertEqual(len(app.preview_canvas.images), 1)
        self.assertIn("15:04  Preview load applied: character | https://example.invalid/live.png", app.log_lines)
        app._render_server_visual.assert_called_once_with(image, "Live asset", "Server render feed")

    def test_start_preview_load_logs_requested_url(self) -> None:
        app = self._make_preview_loader_app()
        with mock.patch("projects.shumilek_ui.main.threading.Thread") as mocked_thread:
            mocked_thread.return_value.start = mock.Mock()

            app._start_preview_load("https://example.invalid/world.png")

        self.assertIn("15:04  Preview load started: https://example.invalid/world.png", app.log_lines)
        self.assertEqual(app.pending_preview_url, "https://example.invalid/world.png")
        app._clear_preview_canvas.assert_called_once_with("Loading preview...")
        app._clear_server_visuals.assert_called_once_with("Loading PixelLab server visual...")

    def test_apply_preview_load_persists_tileset_bootstrap_state(self) -> None:
        app = self._make_preview_loader_app()
        app.active_visual_job_type = "tileset"
        app.active_visual_title = "World asset"
        app.active_visual_subtitle = "Server render feed"
        app.pending_preview_url = "https://example.invalid/world.png"
        app.download_asset_url = "https://example.invalid/world-download.png"

        with tempfile.TemporaryDirectory() as temp_dir:
            cached_path = Path(temp_dir) / "world.png"
            cached_path.write_bytes(b"png-bytes")
            with mock.patch("projects.shumilek_ui.main.tk.PhotoImage", return_value=object()):
                with mock.patch("projects.shumilek_ui.main.save_visual_bootstrap_state") as mocked_save:
                    app._apply_preview_load("https://example.invalid/world.png", 7, cached_path)

        mocked_save.assert_called_once_with(
            cached_path,
            preview_url="https://example.invalid/world.png",
            download_url="https://example.invalid/world-download.png",
            job_type="tileset",
            title="World asset",
            subtitle="Server render feed",
        )

    def test_restore_cached_bootstrap_visual_renders_cached_tileset(self) -> None:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.runtime_session_id = "session-restore"
        app.preview_canvas = _FakeCanvas(width=320, height=240)
        app.asset_status_text = _FakeVar()
        app.asset_source_badge_text = _FakeVar()
        app.asset_meta_text = _FakeVar()
        app.asset_link_text = _FakeVar()
        app.asset_cache_text = _FakeVar()
        app.asset_activity_text = _FakeVar()
        app.sidebar_asset_source_label = _FakeWidget()
        app.summary_asset_source_label = _FakeWidget()
        app.preview_asset_source_label = _FakeWidget()
        app.asset_activity_error = ""
        app.cached_preview_path = None
        app.cached_preview_source_url = ""
        app.cached_download_path = None
        app.cached_download_source_url = ""
        app.loaded_preview_url = ""
        app.current_preview_image = None
        app.active_visual_title = ""
        app.active_visual_subtitle = ""
        app.active_visual_job_type = ""
        app.preview_asset_url = ""
        app.download_asset_url = ""
        app.logs: list[str] = []
        app._append_log = lambda line: app.logs.append(line)
        app._refresh_asset_cache_text = lambda: PixelWorkspaceApp._refresh_asset_cache_text(app)
        app._refresh_asset_activity_text = lambda: None
        app._refresh_asset_action_buttons = mock.Mock()
        app._render_server_visual = mock.Mock()

        with tempfile.TemporaryDirectory() as temp_dir:
            cached_path = Path(temp_dir) / "world.png"
            cached_path.write_bytes(b"png-bytes")
            payload = {
                "cached_path": str(cached_path),
                "preview_url": "https://example.invalid/world.png",
                "download_url": "https://example.invalid/world-download.png",
                "job_type": "tileset",
                "title": "World asset",
                "subtitle": "Server render feed",
            }
            image = object()
            with mock.patch("projects.shumilek_ui.main.load_visual_bootstrap_state", return_value=payload):
                with mock.patch("projects.shumilek_ui.main.tk.PhotoImage", return_value=image):
                    restored = app._restore_cached_bootstrap_visual()

        self.assertTrue(restored)
        self.assertIs(app.current_preview_image, image)
        self.assertEqual(app.cached_preview_path, cached_path)
        self.assertEqual(app.cached_preview_source_url, "https://example.invalid/world.png")
        self.assertEqual(app.loaded_preview_url, "https://example.invalid/world.png")
        self.assertEqual(app.active_visual_job_type, "tileset")
        self.assertEqual(app.active_visual_title, "World asset")
        self.assertEqual(app.active_visual_subtitle, "Server render feed | cached bootstrap")
        self.assertEqual(app.preview_asset_url, "https://example.invalid/world.png")
        self.assertEqual(app.download_asset_url, "https://example.invalid/world-download.png")
        self.assertEqual(app.asset_source_badge_text.get(), "SOURCE: cached bootstrap")
        self.assertEqual(app.asset_status_text.get(), "World asset | cached bootstrap")
        self.assertIn("Source: cached bootstrap", app.asset_meta_text.get())
        self.assertIn(f"Cached path: {cached_path}", app.asset_meta_text.get())
        self.assertIn("Preview: https://example.invalid/world.png", app.asset_meta_text.get())
        self.assertIn("Download: https://example.invalid/world-download.png", app.asset_meta_text.get())
        self.assertIn("Preview: https://example.invalid/world.png", app.asset_link_text.get())
        self.assertIn("Download: https://example.invalid/world-download.png", app.asset_link_text.get())
        self.assertEqual(len(app.preview_canvas.images), 1)
        app._refresh_asset_action_buttons.assert_called_once_with()
        app._render_server_visual.assert_called_once_with(image, "World asset", "Server render feed | cached bootstrap")
        self.assertIn(f"Cached PixelLab world bootstrap candidate: {cached_path}", app.logs[0])
        self.assertIn("session=session-restore", app.logs[0])
        self.assertIn(f"Restored cached PixelLab world feed: {cached_path}", app.logs[1])
        self.assertIn("session=session-restore", app.logs[1])

    def test_restore_cached_bootstrap_visual_accepts_legacy_payload_without_download_url(self) -> None:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.runtime_session_id = "session-restore-legacy"
        app.preview_canvas = _FakeCanvas(width=320, height=240)
        app.asset_status_text = _FakeVar()
        app.asset_source_badge_text = _FakeVar()
        app.asset_meta_text = _FakeVar()
        app.asset_link_text = _FakeVar()
        app.asset_cache_text = _FakeVar()
        app.asset_activity_text = _FakeVar()
        app.sidebar_asset_source_label = _FakeWidget()
        app.summary_asset_source_label = _FakeWidget()
        app.preview_asset_source_label = _FakeWidget()
        app.asset_activity_error = ""
        app.cached_preview_path = None
        app.cached_preview_source_url = ""
        app.cached_download_path = None
        app.cached_download_source_url = ""
        app.loaded_preview_url = ""
        app.current_preview_image = None
        app.active_visual_title = ""
        app.active_visual_subtitle = ""
        app.active_visual_job_type = ""
        app.preview_asset_url = ""
        app.download_asset_url = "stale-download"
        app.logs: list[str] = []
        app._append_log = lambda line: app.logs.append(line)
        app._refresh_asset_cache_text = lambda: PixelWorkspaceApp._refresh_asset_cache_text(app)
        app._refresh_asset_activity_text = lambda: None
        app._refresh_asset_action_buttons = mock.Mock()
        app._render_server_visual = mock.Mock()

        with tempfile.TemporaryDirectory() as temp_dir:
            cached_path = Path(temp_dir) / "world.png"
            cached_path.write_bytes(b"png-bytes")
            payload = {
                "cached_path": str(cached_path),
                "preview_url": "https://example.invalid/world.png",
                "job_type": "tileset",
                "title": "World asset",
                "subtitle": "Server render feed",
            }
            image = object()
            with mock.patch("projects.shumilek_ui.main.load_visual_bootstrap_state", return_value=payload):
                with mock.patch("projects.shumilek_ui.main.tk.PhotoImage", return_value=image):
                    restored = app._restore_cached_bootstrap_visual()

        self.assertTrue(restored)
        self.assertEqual(app.preview_asset_url, "https://example.invalid/world.png")
        self.assertEqual(app.download_asset_url, "")
        self.assertEqual(app.asset_source_badge_text.get(), "SOURCE: cached bootstrap")
        self.assertIn("Source: cached bootstrap", app.asset_meta_text.get())
        self.assertIn("Preview: https://example.invalid/world.png", app.asset_meta_text.get())
        self.assertNotIn("Download:", app.asset_meta_text.get())
        self.assertIn("Preview: https://example.invalid/world.png", app.asset_link_text.get())
        self.assertNotIn("Download:", app.asset_link_text.get())
        app._refresh_asset_action_buttons.assert_called_once_with()

    def test_restore_cached_bootstrap_visual_logs_skipped_invalid_state(self) -> None:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.logs: list[str] = []
        app._append_log = lambda line: app.logs.append(line)

        with mock.patch("projects.shumilek_ui.main.load_visual_bootstrap_state", return_value=None):
            with mock.patch("projects.shumilek_ui.main.describe_visual_bootstrap_state_issue", return_value="state is missing saved_at"):
                restored = app._restore_cached_bootstrap_visual()

        self.assertFalse(restored)
        self.assertIn("Cached PixelLab world bootstrap skipped: state is missing saved_at", app.logs[0])

    def test_restore_cached_bootstrap_visual_logs_skipped_unsupported_job_type(self) -> None:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.logs: list[str] = []
        app._append_log = lambda line: app.logs.append(line)

        payload = {
            "cached_path": "C:/temp/world.png",
            "preview_url": "https://example.invalid/character.png",
            "job_type": "character",
            "title": "Character asset",
            "subtitle": "Preview feed",
        }

        with mock.patch("projects.shumilek_ui.main.load_visual_bootstrap_state", return_value=payload):
            restored = app._restore_cached_bootstrap_visual()

        self.assertFalse(restored)
        self.assertIn("Cached PixelLab world bootstrap skipped: unsupported job_type=character", app.logs[0])

    def test_restore_cached_bootstrap_visual_logs_skipped_unloadable_image(self) -> None:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.logs: list[str] = []
        app._append_log = lambda line: app.logs.append(line)

        with tempfile.TemporaryDirectory() as temp_dir:
            cached_path = Path(temp_dir) / "world.png"
            cached_path.write_bytes(b"not-a-real-png")
            payload = {
                "cached_path": str(cached_path),
                "preview_url": "https://example.invalid/world.png",
                "job_type": "tileset",
                "title": "World asset",
                "subtitle": "Server render feed",
            }

            with mock.patch("projects.shumilek_ui.main.load_visual_bootstrap_state", return_value=payload):
                with mock.patch("projects.shumilek_ui.main.tk.PhotoImage", side_effect=RuntimeError("bad image")):
                    restored = app._restore_cached_bootstrap_visual()

        self.assertFalse(restored)
        self.assertIn(f"Cached PixelLab world bootstrap candidate: {cached_path}", app.logs[0])
        self.assertIn(f"Cached PixelLab world bootstrap skipped: failed to load cached image {cached_path}", app.logs[1])

    def test_render_server_visual_scales_small_preview_for_stage_and_hero(self) -> None:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.FONT_CODE = "Consolas"
        app.active_visual_job_type = "character"
        app.current_stage_image = None
        app.server_visual_text = _FakeVar()
        app.hero_visual_canvas = _FakeCanvas(width=200, height=140)
        app.stage = _FakeCanvas(width=920, height=430)

        image = _FakePhotoImage(width=48, height=48)

        app._render_server_visual(image, "Live asset", "Server render feed")

        self.assertNotEqual(app.current_hero_image, image)
        self.assertNotEqual(app.current_stage_image, image)
        self.assertTrue(str(getattr(app.current_hero_image, "tag", "")).startswith("zoom:"))
        self.assertTrue(str(getattr(app.current_stage_image, "tag", "")).startswith("zoom:"))
        self.assertEqual(app.hero_visual_canvas.images[0][1]["image"], app.current_hero_image)
        self.assertEqual(app.stage.images[0][1]["image"], app.current_stage_image)
        self.assertIn("Live asset | Server render feed", str(app.server_visual_text.get()))

    def test_render_server_visual_tileset_repeats_world_pattern_across_stage(self) -> None:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.FONT_CODE = "Consolas"
        app.active_visual_job_type = "tileset"
        app.log_lines = []
        app._append_log = lambda line: app.log_lines.append(line)
        app.server_visual_text = _FakeVar()
        app.hero_visual_canvas = _FakeCanvas(width=200, height=140)
        app.stage = _FakeCanvas(width=920, height=430)

        image = _FakePhotoImage(width=64, height=64)

        world_image = _FakePhotoImage(width=880, height=322, tag="world-composite")
        app._build_tileset_world_image = mock.Mock(return_value=world_image)

        app._render_server_visual(image, "World asset", "Server render feed")

        app._build_tileset_world_image.assert_called_once_with(image, 880, 322)
        self.assertEqual(len(app.stage.images), 1)
        self.assertEqual(app.stage.images[0][1]["image"], world_image)
        self.assertIs(app.current_stage_image, world_image)
        self.assertIn("World asset | Server render feed", str(app.server_visual_text.get()))
        self.assertIn("15:04  Rendered tileset world feed: World asset", app.log_lines)

    def test_render_processing_server_visual_keeps_live_canvases_blank(self) -> None:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.FONT_CODE = "Consolas"
        app.server_visual_text = _FakeVar()
        app.hero_visual_canvas = _FakeCanvas(width=200, height=140)
        app.stage = _FakeCanvas(width=920, height=430)
        app.current_hero_image = object()
        app.current_stage_image = object()

        job = PixelLabJob(
            job_id="tile-1",
            job_type="tileset",
            label="Tileset",
            prompt="dark topology grid",
            status="processing",
            source="mcp",
        )

        app._render_processing_server_visual(job, [job])

        self.assertIsNone(app.current_hero_image)
        self.assertIsNone(app.current_stage_image)
        self.assertEqual(app.hero_visual_canvas.deleted_tags, ["all"])
        self.assertEqual(app.stage.deleted_tags, ["all"])
        self.assertEqual(app.hero_visual_canvas.texts, [])
        self.assertEqual(app.stage.texts, [])
        self.assertIn("Live PixelLab feed: PROCESSING", str(app.server_visual_text.get()))

    def test_render_processing_server_visual_truncates_long_prompt_summary(self) -> None:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.server_visual_text = _FakeVar()
        app.hero_visual_canvas = _FakeCanvas(width=200, height=140)
        app.stage = _FakeCanvas(width=920, height=430)

        long_prompt = "dark topology grid with layered biomes and route overlays " * 4
        job = PixelLabJob(
            job_id="tile-1",
            job_type="tileset",
            label="Tileset",
            prompt=long_prompt,
            status="processing",
            source="mcp",
        )

        app._render_processing_server_visual(job, [job])

        self.assertIn("Live PixelLab feed: PROCESSING", str(app.server_visual_text.get()))
        self.assertIn("processing |", str(app.server_visual_text.get()))
        self.assertIn("...", str(app.server_visual_text.get()))
        self.assertNotIn(long_prompt, str(app.server_visual_text.get()))

    def test_clear_server_visuals_keeps_live_canvases_blank(self) -> None:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.bridge = _FakeBridge([], has_live_tools=True)
        app.server_visual_text = _FakeVar()
        app.hero_visual_canvas = _FakeCanvas(width=200, height=140)
        app.stage = _FakeCanvas(width=920, height=430)
        app.current_hero_image = object()
        app.current_stage_image = object()

        app._clear_server_visuals("Waiting for first server asset")

        self.assertIsNone(app.current_hero_image)
        self.assertIsNone(app.current_stage_image)
        self.assertEqual(app.hero_visual_canvas.deleted_tags, ["all"])
        self.assertEqual(app.stage.deleted_tags, ["all"])
        self.assertEqual(app.hero_visual_canvas.texts, [])
        self.assertEqual(app.stage.texts, [])
        self.assertEqual(str(app.server_visual_text.get()), "Waiting for first server asset")

    def test_refresh_asset_preview_truncates_long_meta_fields_for_ready_asset(self) -> None:
        long_prompt = "dark topology grid with layered biomes and route overlays " * 4
        long_detail = "tile atlas variant with long diagnostic description " * 3
        jobs = [
            PixelLabJob(
                job_id="tile-1",
                job_type="tileset",
                label="Tileset",
                prompt=long_prompt,
                status="ready",
                source="mcp",
                asset_name="world_sheet.png",
                detail=long_detail,
                preview_url="https://example.invalid/world.png",
            ),
        ]
        app = self._make_preview_app(jobs)

        app._refresh_asset_preview()

        self.assertIn("Prompt: ", app.asset_meta_text.get())
        self.assertIn("Detail: ", app.asset_meta_text.get())
        self.assertIn("...", app.asset_meta_text.get())
        self.assertNotIn(long_prompt, app.asset_meta_text.get())
        self.assertNotIn(long_detail, app.asset_meta_text.get())

    def test_refresh_bridge_activity_text_updates_summary_card_tone(self) -> None:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.bridge_action_in_progress = {"poll_jobs"}
        app.bridge_activity_error = ""
        app.poll_debounce_after_id = None
        app.poll_follow_up_requested = False
        app.auto_poll_after_id = None
        app.auto_poll_enabled = _FakeVar(True)
        app.auto_poll_seconds = _FakeVar(3)
        app.bridge_activity_text = _FakeVar()
        app.bridge_activity_label = _FakeWidget()
        app.summary_queue_card = _FakeWidget()
        app.summary_queue_title_label = _FakeWidget()
        app.summary_bridge_activity_label = _FakeWidget()
        app.sidebar_bridge_card = _FakeWidget()
        app.sidebar_bridge_title_label = _FakeWidget()
        app.sidebar_bridge_activity_label = _FakeWidget()
        app.sidebar_job_summary_label = _FakeWidget()

        app._refresh_bridge_activity_text()

        expected_body = app._blend_color(PALETTE["muted"], app.STATUS_TONE_COLORS["busy"], 0.42)
        expected_border = app._blend_color(PALETTE["panel_edge"], app.STATUS_TONE_COLORS["busy"], 0.7)
        self.assertIn("Polling", str(app.bridge_activity_text.get()))
        self.assertEqual(app.bridge_activity_label.options["fg"], app.STATUS_TONE_COLORS["busy"])
        self.assertEqual(app.summary_queue_card.options["highlightbackground"], expected_border)
        self.assertEqual(app.summary_queue_title_label.options["fg"], app.STATUS_TONE_COLORS["busy"])
        self.assertEqual(app.summary_bridge_activity_label.options["fg"], expected_body)
        self.assertEqual(app.sidebar_bridge_card.options["highlightbackground"], expected_border)
        self.assertEqual(app.sidebar_bridge_title_label.options["fg"], app.STATUS_TONE_COLORS["busy"])
        self.assertEqual(app.sidebar_bridge_activity_label.options["fg"], expected_body)
        self.assertEqual(app.sidebar_job_summary_label.options["fg"], expected_body)

    def test_refresh_bridge_activity_text_reports_paused_automation_when_auto_poll_disabled(self) -> None:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.bridge_action_in_progress = set()
        app.bridge_activity_error = ""
        app.poll_debounce_after_id = None
        app.poll_follow_up_requested = False
        app.auto_poll_after_id = None
        app.auto_poll_enabled = _FakeVar(False)
        app.auto_poll_seconds = _FakeVar(3)
        app.bridge_activity_text = _FakeVar()
        app.bridge_activity_label = _FakeWidget()
        app.summary_queue_card = _FakeWidget()
        app.summary_queue_title_label = _FakeWidget()
        app.summary_bridge_activity_label = _FakeWidget()
        app.sidebar_bridge_card = _FakeWidget()
        app.sidebar_bridge_title_label = _FakeWidget()
        app.sidebar_bridge_activity_label = _FakeWidget()
        app.sidebar_job_summary_label = _FakeWidget()

        app._refresh_bridge_activity_text()

        expected_body = app._blend_color(PALETTE["muted"], app.STATUS_TONE_COLORS["idle"], 0.42)
        expected_border = app._blend_color(PALETTE["panel_edge"], app.STATUS_TONE_COLORS["idle"], 0.7)
        self.assertEqual(app.bridge_activity_text.get(), "Automation paused. Queue will not auto-refresh.")
        self.assertEqual(app.bridge_activity_label.options["fg"], app.STATUS_TONE_COLORS["idle"])
        self.assertEqual(app.summary_queue_card.options["highlightbackground"], expected_border)
        self.assertEqual(app.summary_bridge_activity_label.options["fg"], expected_body)

    def test_refresh_asset_activity_text_updates_summary_card_tone(self) -> None:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.preview_asset_url = "https://example.invalid/preview.png"
        app.download_asset_url = ""
        app.pending_preview_url = ""
        app.asset_action_in_progress = set()
        app.cache_refresh_in_progress = False
        app.asset_activity_error = ""
        app.asset_activity_text = _FakeVar()
        app.asset_activity_label = _FakeWidget()
        app.summary_asset_card = _FakeWidget()
        app.summary_asset_title_label = _FakeWidget()
        app.summary_asset_activity_label = _FakeWidget()
        app.sidebar_asset_card = _FakeWidget()
        app.sidebar_asset_title_label = _FakeWidget()
        app.sidebar_asset_activity_label = _FakeWidget()
        app.sidebar_asset_cache_label = _FakeWidget()

        app._refresh_asset_activity_text()

        expected_body = app._blend_color(PALETTE["muted"], app.STATUS_TONE_COLORS["ready"], 0.42)
        expected_border = app._blend_color(PALETTE["panel_edge"], app.STATUS_TONE_COLORS["ready"], 0.7)
        self.assertIn("Ready", str(app.asset_activity_text.get()))
        self.assertEqual(app.asset_activity_label.options["fg"], app.STATUS_TONE_COLORS["ready"])
        self.assertEqual(app.summary_asset_card.options["highlightbackground"], expected_border)
        self.assertEqual(app.summary_asset_title_label.options["fg"], app.STATUS_TONE_COLORS["ready"])
        self.assertEqual(app.summary_asset_activity_label.options["fg"], expected_body)
        self.assertEqual(app.sidebar_asset_card.options["highlightbackground"], expected_border)
        self.assertEqual(app.sidebar_asset_title_label.options["fg"], app.STATUS_TONE_COLORS["ready"])
        self.assertEqual(app.sidebar_asset_activity_label.options["fg"], expected_body)
        self.assertEqual(app.sidebar_asset_cache_label.options["fg"], expected_body)

    def test_scene_node_at_returns_matching_region(self) -> None:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.scene_node_regions = {
            "flow": (10, 20, 80, 70),
            "workspace": (100, 30, 200, 90),
        }

        self.assertEqual(app._scene_node_at(40, 40), "flow")
        self.assertEqual(app._scene_node_at(150, 60), "workspace")
        self.assertIsNone(app._scene_node_at(250, 60))

    def test_focus_scene_node_updates_focus_and_status(self) -> None:
        app = PixelWorkspaceApp.__new__(PixelWorkspaceApp)
        app.selected_node = _FakeVar("Korunovy workspace")
        app.status_text = _FakeVar("old")
        app.log_lines = []
        app._append_log = lambda line: app.log_lines.append(line)
        app._draw_scene = lambda: None

        app._focus_scene_node("guardian")

        self.assertEqual(app.selected_node.get(), "Svetluskovy guardian")
        self.assertEqual(app.status_text.get(), "Kvalita a validace")
        self.assertEqual(app.log_lines[-1], "15:07  Focus moved to Svetluskovy guardian")


if __name__ == "__main__":
    unittest.main()