import unittest

from projects.shumilek_ui.pixellab_bridge import PixelLabJob
from projects.shumilek_ui.ui_helpers import (
    asset_action_url,
    asset_activity_tone,
    asset_ready_counts,
    asset_ready_jobs,
    build_asset_activity_text,
    build_bridge_activity_text,
    build_asset_link_text,
    bridge_activity_tone,
    cache_refresh_targets,
    build_tracked_job_detail,
    choose_asset_job,
    choose_preview_url,
    compose_character_prompt,
    compose_tileset_prompts,
    compose_graph_character_prompt,
    compose_graph_tileset_prompts,
    image_like_download_url,
    normalize_server_style_preset,
    normalize_poll_interval_seconds,
    server_style_preset_label,
    should_apply_preview_result,
    should_reload_preview,
    summarize_asset_history_entry,
    summarize_tracked_job_entry,
)


class UiHelperTests(unittest.TestCase):
    def test_bridge_activity_tone_tracks_alert_and_busy_states(self) -> None:
        self.assertEqual(bridge_activity_tone(["poll_jobs"], "boom"), "alert")
        self.assertEqual(bridge_activity_tone(["poll_jobs"]), "busy")
        self.assertEqual(bridge_activity_tone([], poll_scheduled=True), "busy")
        self.assertEqual(bridge_activity_tone([], auto_poll_armed=True), "busy")
        self.assertEqual(bridge_activity_tone([]), "idle")

    def test_build_bridge_activity_text_prioritizes_error_then_action(self) -> None:
        self.assertEqual(
            build_bridge_activity_text(["queue_character"], "bridge unavailable"),
            "Alert: bridge unavailable",
        )
        self.assertEqual(
            build_bridge_activity_text(["poll_jobs"], poll_follow_up_requested=True),
            "Current poll is running, one more refresh is queued.",
        )
        self.assertEqual(
            build_bridge_activity_text(["poll_jobs"]),
            "Polling live jobs in background...",
        )
        self.assertEqual(
            build_bridge_activity_text([], poll_scheduled=True),
            "Poll request debounced, starting shortly...",
        )
        self.assertEqual(
            build_bridge_activity_text([], auto_poll_armed=True, auto_poll_seconds=5),
            "Auto-poll every 5s is active, next refresh is scheduled.",
        )
        self.assertEqual(
            build_bridge_activity_text([], auto_poll_enabled=False),
            "Automation paused. Queue will not auto-refresh.",
        )
        self.assertEqual(build_bridge_activity_text([]), "Queue is idle.")

    def test_normalize_poll_interval_seconds_clamps_and_defaults(self) -> None:
        self.assertEqual(normalize_poll_interval_seconds("7"), 7)
        self.assertEqual(normalize_poll_interval_seconds("0"), 1)
        self.assertEqual(normalize_poll_interval_seconds("99"), 30)
        self.assertEqual(normalize_poll_interval_seconds("oops"), 3)

    def test_build_asset_activity_text_prioritizes_error_and_async_state(self) -> None:
        self.assertEqual(
            build_asset_activity_text(True, "", [], False, "preview failed"),
            "Alert: preview failed",
        )
        self.assertEqual(
            build_asset_activity_text(True, "", ["open_preview"], False),
            "Preparing preview asset...",
        )
        self.assertEqual(
            build_asset_activity_text(True, "https://example.invalid/preview.png", [], False),
            "Loading preview in background...",
        )
        self.assertEqual(
            build_asset_activity_text(False, "", [], False),
            "Waiting for the first ready asset.",
        )

    def test_asset_activity_tone_tracks_alert_busy_ready_and_idle(self) -> None:
        self.assertEqual(asset_activity_tone(True, "", [], False, "preview failed"), "alert")
        self.assertEqual(asset_activity_tone(True, "", ["open_preview"], False), "busy")
        self.assertEqual(asset_activity_tone(True, "", [], False), "ready")
        self.assertEqual(asset_activity_tone(False, "", [], False), "idle")

    def test_asset_action_url_returns_requested_asset_type(self) -> None:
        self.assertEqual(
            asset_action_url("preview", "https://example.invalid/preview.png", "https://example.invalid/archive.zip"),
            "https://example.invalid/preview.png",
        )
        self.assertEqual(
            asset_action_url("download", "https://example.invalid/preview.png", "https://example.invalid/archive.zip"),
            "https://example.invalid/archive.zip",
        )
        self.assertEqual(asset_action_url("other", "a", "b"), "")

    def test_asset_ready_jobs_filters_and_limits_recent_assets(self) -> None:
        jobs = [
            PixelLabJob(job_id="1", job_type="character", label="Character", prompt="one", status="queued", source="mcp"),
            PixelLabJob(job_id="2", job_type="character", label="Character", prompt="two", status="ready", source="mcp"),
            PixelLabJob(job_id="3", job_type="tileset", label="Tileset", prompt="three", status="queued", source="mcp", preview_url="https://example.invalid/three.png"),
        ]

        result = asset_ready_jobs(jobs, limit=2)

        self.assertEqual([job.job_id for job in result], ["2", "3"])
        self.assertEqual([job.job_id for job in asset_ready_jobs(jobs, limit=5, job_type_filter="character")], ["2"])
        self.assertEqual([job.job_id for job in asset_ready_jobs(jobs, limit=5, job_type_filter="tileset")], ["3"])
        self.assertEqual(asset_ready_counts(jobs), {"all": 2, "character": 1, "tileset": 1})

    def test_choose_preview_url_prefers_explicit_preview(self) -> None:
        self.assertEqual(
            choose_preview_url("https://example.invalid/preview.png", "https://example.invalid/archive.zip"),
            "https://example.invalid/preview.png",
        )

    def test_choose_asset_job_prefers_selected_history_entry(self) -> None:
        jobs = [
            PixelLabJob(job_id="newest", job_type="tileset", label="Tileset", prompt="recent", status="ready", source="mcp"),
            PixelLabJob(job_id="older", job_type="character", label="Character", prompt="older", status="queued", source="mcp", preview_url="https://example.invalid/older.png"),
        ]

        self.assertEqual(choose_asset_job(jobs, "older").job_id, "older")
        self.assertEqual(choose_asset_job(jobs, "missing").job_id, "newest")
        self.assertEqual(choose_asset_job(jobs, "missing", job_type_filter="character").job_id, "older")

    def test_choose_asset_job_prefers_graph_style_asset_by_default(self) -> None:
        jobs = [
            PixelLabJob(job_id="plain", job_type="character", label="Character", prompt="forest spirit archivist", status="ready", source="mcp", preview_url="https://example.invalid/plain.png"),
            PixelLabJob(job_id="graph", job_type="character", label="Character", prompt="graph navigator operator, style preset: graph-workbench, dark graph-workbench operator portrait", status="ready", source="mcp", preview_url="https://example.invalid/graph.png"),
        ]

        self.assertEqual(choose_asset_job(jobs).job_id, "graph")

    def test_choose_asset_job_prefers_requested_server_style_preset(self) -> None:
        jobs = [
            PixelLabJob(job_id="graph", job_type="character", label="Character", prompt="graph navigator operator, style preset: graph-workbench, dark graph-workbench operator portrait", status="ready", source="mcp", preview_url="https://example.invalid/graph.png"),
            PixelLabJob(job_id="dark-map", job_type="character", label="Character", prompt="network cartographer, style preset: dark-network-map, dark network cartographer", status="ready", source="mcp", preview_url="https://example.invalid/dark-map.png"),
        ]

        self.assertEqual(choose_asset_job(jobs, preferred_style_preset="dark_network_map").job_id, "dark-map")

    def test_choose_asset_job_prefers_tileset_world_asset_when_unfiltered(self) -> None:
        jobs = [
            PixelLabJob(job_id="graph", job_type="character", label="Character", prompt="graph navigator operator, style preset: graph-workbench, dark graph-workbench operator portrait", status="ready", source="mcp", preview_url="https://example.invalid/graph.png"),
            PixelLabJob(job_id="graph-world", job_type="tileset", label="Tileset", prompt="dark topology grid, style preset: graph-workbench", status="ready", source="mcp", preview_url="https://example.invalid/world.png"),
        ]

        self.assertEqual(choose_asset_job(jobs).job_id, "graph-world")

    def test_choose_preview_url_falls_back_to_image_like_download(self) -> None:
        self.assertEqual(
            choose_preview_url("", "https://example.invalid/sheet.png"),
            "https://example.invalid/sheet.png",
        )
        self.assertEqual(image_like_download_url("https://example.invalid/archive.zip"), "")

    def test_compose_graph_character_prompt_appends_graph_workbench_style(self) -> None:
        result = compose_graph_character_prompt("graph navigator operator")

        self.assertIn("graph navigator operator", result)
        self.assertIn("style preset: graph-workbench", result)
        self.assertIn("dark graph-workbench operator portrait", result)
        self.assertIn("luminous cyan teal mint signal lights", result)

    def test_compose_graph_tileset_prompts_styles_both_layers(self) -> None:
        lower, upper = compose_graph_tileset_prompts("dark topology grid", "cyan teal node lattice")

        self.assertIn("dark topology grid", lower)
        self.assertIn("style preset: graph-workbench", lower)
        self.assertIn("charcoal topology floor", lower)
        self.assertIn("cyan teal node lattice", upper)
        self.assertIn("style preset: graph-workbench", upper)
        self.assertIn("luminous node clusters", upper)

    def test_compose_character_prompt_uses_selected_preset(self) -> None:
        result = compose_character_prompt("network cartographer", "dark_network_map")

        self.assertIn("network cartographer", result)
        self.assertIn("style preset: dark-network-map", result)
        self.assertIn("electric blue and white signal nodes", result)

    def test_compose_tileset_prompts_uses_selected_preset(self) -> None:
        lower, upper = compose_tileset_prompts("mapping table", "signal overlay", "control_room_lattice")

        self.assertIn("mapping table", lower)
        self.assertIn("style preset: control-room-lattice", lower)
        self.assertIn("modular console floor", lower)
        self.assertIn("signal overlay", upper)
        self.assertIn("style preset: control-room-lattice", upper)
        self.assertIn("teal interface clusters", upper)

    def test_server_style_preset_normalization_and_labels(self) -> None:
        self.assertEqual(normalize_server_style_preset("dark_network_map"), "dark_network_map")
        self.assertEqual(normalize_server_style_preset("unknown"), "graph_workbench")
        self.assertEqual(server_style_preset_label("control_room_lattice"), "Control Room Lattice")

    def test_cache_refresh_targets_include_preview_and_download(self) -> None:
        self.assertEqual(
            cache_refresh_targets("", "https://example.invalid/sheet.png"),
            [
                ("preview", "https://example.invalid/sheet.png"),
                ("download", "https://example.invalid/sheet.png"),
            ],
        )
        self.assertEqual(
            cache_refresh_targets("https://example.invalid/preview.png", "https://example.invalid/archive.zip"),
            [
                ("preview", "https://example.invalid/preview.png"),
                ("download", "https://example.invalid/archive.zip"),
            ],
        )

    def test_build_asset_link_text_omits_missing_values(self) -> None:
        self.assertEqual(build_asset_link_text("", ""), "")
        self.assertEqual(
            build_asset_link_text("https://example.invalid/preview.png", ""),
            "Preview: https://example.invalid/preview.png",
        )

    def test_should_apply_preview_result_requires_matching_request_and_url(self) -> None:
        self.assertTrue(should_apply_preview_result(4, 4, "https://example.invalid/preview.png", "https://example.invalid/preview.png"))
        self.assertFalse(should_apply_preview_result(4, 3, "https://example.invalid/preview.png", "https://example.invalid/preview.png"))
        self.assertFalse(should_apply_preview_result(4, 4, "https://example.invalid/current.png", "https://example.invalid/preview.png"))

    def test_should_reload_preview_only_when_needed(self) -> None:
        self.assertFalse(should_reload_preview("https://example.invalid/preview.png", "https://example.invalid/preview.png", True))
        self.assertTrue(should_reload_preview("https://example.invalid/old.png", "https://example.invalid/new.png", True))
        self.assertTrue(should_reload_preview("", "https://example.invalid/new.png", False))
        self.assertFalse(should_reload_preview("https://example.invalid/preview.png", "", True))

    def test_summarize_asset_history_entry_prefers_asset_name(self) -> None:
        job = PixelLabJob(
            job_id="2",
            job_type="character",
            label="Character",
            prompt="forest spirit archivist",
            status="ready",
            source="mcp",
            asset_name="forest_spirit_sheet.png",
        )

        self.assertEqual(summarize_asset_history_entry(job), "[ready] forest_spirit_sheet.png")

    def test_summarize_tracked_job_entry_includes_type_and_summary(self) -> None:
        job = PixelLabJob(
            job_id="2",
            job_type="character",
            label="Character queued",
            prompt="forest spirit archivist with detailed moss satchel",
            status="queued",
            source="mcp",
        )

        self.assertEqual(summarize_tracked_job_entry(job), "[queued] character | forest spirit archivist with detailed m...")

    def test_build_tracked_job_detail_includes_optional_asset_fields(self) -> None:
        job = PixelLabJob(
            job_id="2",
            job_type="tileset",
            label="Tileset queued",
            prompt="mossy floor",
            status="ready",
            source="mcp",
            detail="48x48",
            asset_name="mossy_floor_sheet.png",
            preview_url="https://example.invalid/preview.png",
            download_url="https://example.invalid/download.zip",
        )

        self.assertEqual(
            build_tracked_job_detail(job),
            "Type: tileset\nStatus: ready\nSource: mcp\nPrompt: mossy floor\nDetail: 48x48\nAsset: mossy_floor_sheet.png\nPreview: https://example.invalid/preview.png\nDownload: https://example.invalid/download.zip",
        )


if __name__ == "__main__":
    unittest.main()