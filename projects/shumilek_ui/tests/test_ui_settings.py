from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from projects.shumilek_ui.ui_settings import DEFAULT_UI_SETTINGS, load_ui_settings, normalize_ui_settings, save_ui_settings


class UiSettingsTests(unittest.TestCase):
    def test_normalize_ui_settings_clamps_interval_and_filter(self) -> None:
        normalized = normalize_ui_settings(
            {
                "auto_poll_enabled": 1,
                "auto_poll_seconds": 999,
                "asset_history_filter": "unsupported",
                "server_style_preset": "unsupported",
            }
        )

        self.assertEqual(
            normalized,
            {
                "auto_poll_enabled": True,
                "auto_poll_seconds": 30,
                "asset_history_filter": "all",
                "server_style_preset": "graph_workbench",
            },
        )

    def test_load_ui_settings_returns_defaults_for_missing_or_invalid_file(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            missing_path = Path(temp_dir) / "missing.json"
            self.assertEqual(load_ui_settings(missing_path), DEFAULT_UI_SETTINGS)

            invalid_path = Path(temp_dir) / "invalid.json"
            invalid_path.write_text("{broken", encoding="utf-8")
            self.assertEqual(load_ui_settings(invalid_path), DEFAULT_UI_SETTINGS)

    def test_save_ui_settings_round_trips_supported_preferences(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            settings_path = Path(temp_dir) / "prefs" / "ui.json"
            save_ui_settings(
                {
                    "auto_poll_enabled": True,
                    "auto_poll_seconds": "7",
                    "asset_history_filter": "tileset",
                    "server_style_preset": "dark_network_map",
                },
                settings_path,
            )

            self.assertEqual(
                load_ui_settings(settings_path),
                {
                    "auto_poll_enabled": True,
                    "auto_poll_seconds": 7,
                    "asset_history_filter": "tileset",
                    "server_style_preset": "dark_network_map",
                },
            )

    # ------------------------------------------------------------------
    # Round 33 – expanded coverage
    # ------------------------------------------------------------------

    def test_normalize_ui_settings_non_dict_returns_defaults(self) -> None:
        self.assertEqual(normalize_ui_settings(None), DEFAULT_UI_SETTINGS)
        self.assertEqual(normalize_ui_settings("garbage"), DEFAULT_UI_SETTINGS)
        self.assertEqual(normalize_ui_settings(42), DEFAULT_UI_SETTINGS)

    def test_normalize_ui_settings_partial_dict_fills_defaults(self) -> None:
        result = normalize_ui_settings({"auto_poll_enabled": True})
        self.assertTrue(result["auto_poll_enabled"])
        self.assertEqual(result["auto_poll_seconds"], DEFAULT_UI_SETTINGS["auto_poll_seconds"])
        self.assertEqual(result["asset_history_filter"], DEFAULT_UI_SETTINGS["asset_history_filter"])
        self.assertEqual(result["server_style_preset"], DEFAULT_UI_SETTINGS["server_style_preset"])

    def test_save_ui_settings_atomic_leaves_no_tmp_on_success(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            settings_path = Path(temp_dir) / "s.json"
            save_ui_settings(DEFAULT_UI_SETTINGS, settings_path)

            siblings = list(Path(temp_dir).iterdir())
            self.assertEqual(len(siblings), 1)
            self.assertEqual(siblings[0].name, "s.json")

    def test_save_ui_settings_cleans_tmp_on_replace_error(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            settings_path = Path(temp_dir) / "s.json"
            with patch("projects.shumilek_ui.ui_settings.os.replace", side_effect=OSError("mock")):
                with self.assertRaises(OSError):
                    save_ui_settings(DEFAULT_UI_SETTINGS, settings_path)

            tmp_files = [f for f in Path(temp_dir).iterdir() if f.suffix == ".tmp"]
            self.assertEqual(len(tmp_files), 0, "temp file should be cleaned up on failure")

    def test_save_ui_settings_normalizes_before_write(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            settings_path = Path(temp_dir) / "n.json"
            save_ui_settings({"auto_poll_seconds": 999}, settings_path)

            raw = json.loads(settings_path.read_text(encoding="utf-8"))
            self.assertEqual(raw["auto_poll_seconds"], 30)

    def test_load_ui_settings_default_path_does_not_crash(self) -> None:
        # Just verify default_ui_settings_path() returns a Path without error
        from projects.shumilek_ui.ui_settings import default_ui_settings_path
        path = default_ui_settings_path()
        self.assertIsInstance(path, Path)
        self.assertTrue(path.name.endswith(".json"))

    def test_load_ui_settings_rejects_oversized_file(self) -> None:
        """Files > 100 KB should return defaults (R50)."""
        from projects.shumilek_ui.ui_settings import load_ui_settings, DEFAULT_UI_SETTINGS
        with tempfile.TemporaryDirectory() as td:
            settings_path = Path(td) / "big.json"
            settings_path.write_text("x" * 200_000, encoding="utf-8")
            result = load_ui_settings(settings_path)
            self.assertEqual(result, dict(DEFAULT_UI_SETTINGS))

    def test_load_ui_settings_accepts_normal_file(self) -> None:
        """Normal-sized valid JSON should load fine."""
        from projects.shumilek_ui.ui_settings import load_ui_settings
        with tempfile.TemporaryDirectory() as td:
            settings_path = Path(td) / "ok.json"
            settings_path.write_text('{"auto_poll_seconds": 20}', encoding="utf-8")
            result = load_ui_settings(settings_path)
            self.assertEqual(result["auto_poll_seconds"], 20)


if __name__ == "__main__":
    unittest.main()