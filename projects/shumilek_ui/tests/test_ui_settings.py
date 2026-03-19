from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

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


if __name__ == "__main__":
    unittest.main()