from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

try:
    from ui_helpers import DEFAULT_SERVER_STYLE_PRESET, normalize_poll_interval_seconds, normalize_server_style_preset
except ImportError:
    from .ui_helpers import DEFAULT_SERVER_STYLE_PRESET, normalize_poll_interval_seconds, normalize_server_style_preset


DEFAULT_UI_SETTINGS = {
    "auto_poll_enabled": False,
    "auto_poll_seconds": 3,
    "asset_history_filter": "all",
    "server_style_preset": DEFAULT_SERVER_STYLE_PRESET,
}

VALID_ASSET_HISTORY_FILTERS = frozenset({"all", "character", "tileset"})


def default_ui_settings_path() -> Path:
    if os.name == "nt":
        base_dir = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
    else:
        base_dir = Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local" / "state"))
    return base_dir / "Shumilek" / "pixel_workspace_settings.json"


def normalize_ui_settings(raw_settings: object) -> dict[str, object]:
    if not isinstance(raw_settings, dict):
        raw_settings = {}

    history_filter = raw_settings.get("asset_history_filter", DEFAULT_UI_SETTINGS["asset_history_filter"])
    if history_filter not in VALID_ASSET_HISTORY_FILTERS:
        history_filter = DEFAULT_UI_SETTINGS["asset_history_filter"]

    return {
        "auto_poll_enabled": bool(raw_settings.get("auto_poll_enabled", DEFAULT_UI_SETTINGS["auto_poll_enabled"])),
        "auto_poll_seconds": normalize_poll_interval_seconds(
            raw_settings.get("auto_poll_seconds", DEFAULT_UI_SETTINGS["auto_poll_seconds"])
        ),
        "asset_history_filter": history_filter,
        "server_style_preset": normalize_server_style_preset(
            raw_settings.get("server_style_preset", DEFAULT_UI_SETTINGS["server_style_preset"])
        ),
    }


def load_ui_settings(path: Path | None = None) -> dict[str, object]:
    settings_path = path or default_ui_settings_path()
    try:
        raw_settings = json.loads(settings_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return dict(DEFAULT_UI_SETTINGS)
    return normalize_ui_settings(raw_settings)


def save_ui_settings(settings: object, path: Path | None = None) -> Path:
    settings_path = path or default_ui_settings_path()
    normalized = normalize_ui_settings(settings)
    settings_path.parent.mkdir(parents=True, exist_ok=True)
    content = f"{json.dumps(normalized, indent=2)}\n"
    fd, tmp_path = tempfile.mkstemp(dir=str(settings_path.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as tmp_file:
            tmp_file.write(content)
        os.replace(tmp_path, str(settings_path))
    except BaseException:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise
    return settings_path