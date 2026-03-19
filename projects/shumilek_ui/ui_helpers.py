from __future__ import annotations

from collections.abc import Sequence
from typing import Any


IMAGE_EXTENSIONS = (".png", ".gif", ".ppm", ".pgm")

SERVER_STYLE_PRESETS = {
    "graph_workbench": {
        "marker": "style preset: graph-workbench",
        "label": "Graph Workbench",
        "character_suffix": (
            "style preset: graph-workbench, dark graph-workbench operator portrait, dense node-link observatory, "
            "charcoal control-room backdrop, luminous cyan teal mint signal lights, "
            "high-contrast network map atmosphere, precise readable silhouette"
        ),
        "tileset_lower_suffix": (
            "style preset: graph-workbench, charcoal topology floor, subtle graph grid, faint node-link pathways, "
            "dark analytics workspace surface"
        ),
        "tileset_upper_suffix": (
            "style preset: graph-workbench, luminous node clusters, thin graph edges, cyan teal green signal markers, "
            "observatory overlay, network-analysis canopy"
        ),
        "keywords": (
            "graph-workbench",
            "node-link",
            "topology",
            "node lattice",
            "network-analysis",
            "graph navigator operator",
        ),
    },
    "dark_network_map": {
        "marker": "style preset: dark-network-map",
        "label": "Dark Network Map",
        "character_suffix": (
            "style preset: dark-network-map, dark network cartographer, black observatory backdrop, "
            "dim constellation graph, electric blue and white signal nodes, sparse luminous topology, sharp tactical silhouette"
        ),
        "tileset_lower_suffix": (
            "style preset: dark-network-map, black topology floor, sparse constellation mesh, low-noise graph surface, dark mapping table"
        ),
        "tileset_upper_suffix": (
            "style preset: dark-network-map, bright blue node sparks, thin white graph edges, constellation clusters, long-range map overlay"
        ),
        "keywords": (
            "dark-network-map",
            "constellation",
            "graph edges",
            "network cartographer",
            "map overlay",
        ),
    },
    "control_room_lattice": {
        "marker": "style preset: control-room-lattice",
        "label": "Control Room Lattice",
        "character_suffix": (
            "style preset: control-room-lattice, command deck analyst portrait, layered control-room monitors, "
            "teal green lattice signals, dense interface clusters, structured cyber observatory mood"
        ),
        "tileset_lower_suffix": (
            "style preset: control-room-lattice, modular console floor, structured monitor grid, panel lattice, dark command surface"
        ),
        "tileset_upper_suffix": (
            "style preset: control-room-lattice, teal interface clusters, bright status nodes, lattice overlays, operational control canopy"
        ),
        "keywords": (
            "control-room-lattice",
            "command deck",
            "monitor grid",
            "interface clusters",
            "status nodes",
        ),
    },
}

DEFAULT_SERVER_STYLE_PRESET = "graph_workbench"
VALID_SERVER_STYLE_PRESETS = frozenset(SERVER_STYLE_PRESETS)


def normalize_server_style_preset(raw_value: object) -> str:
    preset = str(raw_value or DEFAULT_SERVER_STYLE_PRESET).strip().lower()
    if preset not in VALID_SERVER_STYLE_PRESETS:
        return DEFAULT_SERVER_STYLE_PRESET
    return preset


def server_style_preset_label(preset: str) -> str:
    normalized = normalize_server_style_preset(preset)
    return str(SERVER_STYLE_PRESETS[normalized]["label"])


def compose_character_prompt(prompt: str, preset: str = DEFAULT_SERVER_STYLE_PRESET) -> str:
    normalized = normalize_server_style_preset(preset)
    suffix = str(SERVER_STYLE_PRESETS[normalized]["character_suffix"])
    base = str(prompt).strip()
    if not base:
        return suffix
    return f"{base}, {suffix}"


def compose_tileset_prompts(lower_prompt: str, upper_prompt: str, preset: str = DEFAULT_SERVER_STYLE_PRESET) -> tuple[str, str]:
    normalized = normalize_server_style_preset(preset)
    lower_suffix = str(SERVER_STYLE_PRESETS[normalized]["tileset_lower_suffix"])
    upper_suffix = str(SERVER_STYLE_PRESETS[normalized]["tileset_upper_suffix"])
    lower_base = str(lower_prompt).strip()
    upper_base = str(upper_prompt).strip()
    lower = lower_suffix if not lower_base else f"{lower_base}, {lower_suffix}"
    upper = upper_suffix if not upper_base else f"{upper_base}, {upper_suffix}"
    return lower, upper


def compose_graph_character_prompt(prompt: str) -> str:
    return compose_character_prompt(prompt, DEFAULT_SERVER_STYLE_PRESET)


def compose_graph_tileset_prompts(lower_prompt: str, upper_prompt: str) -> tuple[str, str]:
    return compose_tileset_prompts(lower_prompt, upper_prompt, DEFAULT_SERVER_STYLE_PRESET)


def image_like_download_url(url: str) -> str:
    lowered = url.lower()
    if lowered.endswith(IMAGE_EXTENSIONS):
        return url
    return ""


def choose_preview_url(preview_url: str, download_url: str) -> str:
    return preview_url or image_like_download_url(download_url)


def asset_action_url(label: str, preview_url: str, download_url: str) -> str:
    if label == "preview":
        return preview_url
    if label == "download":
        return download_url
    return ""


def build_asset_activity_text(
    has_asset: bool,
    pending_preview_url: str,
    action_keys: Sequence[str],
    cache_refresh_in_progress: bool,
    error_text: str = "",
) -> str:
    if error_text:
        return f"Alert: {error_text}"
    if cache_refresh_in_progress:
        return "Refreshing cache in background..."
    if "save_preview" in action_keys:
        return "Preparing preview export..."
    if "save_download" in action_keys:
        return "Preparing download export..."
    if "open_preview" in action_keys:
        return "Preparing preview asset..."
    if "open_download" in action_keys:
        return "Preparing download asset..."
    if pending_preview_url:
        return "Loading preview in background..."
    if has_asset:
        return "Ready for open, save, or refresh."
    return "Waiting for the first ready asset."


def asset_activity_tone(
    has_asset: bool,
    pending_preview_url: str,
    action_keys: Sequence[str],
    cache_refresh_in_progress: bool,
    error_text: str = "",
) -> str:
    if error_text:
        return "alert"
    if cache_refresh_in_progress or action_keys or pending_preview_url:
        return "busy"
    if has_asset:
        return "ready"
    return "idle"


def build_bridge_activity_text(
    action_keys: Sequence[str],
    error_text: str = "",
    poll_scheduled: bool = False,
    poll_follow_up_requested: bool = False,
    auto_poll_armed: bool = False,
    auto_poll_enabled: bool = True,
    auto_poll_seconds: int = 3,
) -> str:
    if error_text:
        return f"Alert: {error_text}"
    if "poll_jobs" in action_keys and poll_follow_up_requested:
        return "Current poll is running, one more refresh is queued."
    if "poll_jobs" in action_keys:
        return "Polling live jobs in background..."
    if poll_scheduled:
        return "Poll request debounced, starting shortly..."
    if auto_poll_armed:
        return f"Auto-poll every {auto_poll_seconds}s is active, next refresh is scheduled."
    if "queue_character" in action_keys:
        return "Queueing character in background..."
    if "queue_tileset" in action_keys:
        return "Queueing tileset in background..."
    if not auto_poll_enabled:
        return "Automation paused. Queue will not auto-refresh."
    return "Queue is idle."


def bridge_activity_tone(
    action_keys: Sequence[str],
    error_text: str = "",
    poll_scheduled: bool = False,
    poll_follow_up_requested: bool = False,
    auto_poll_armed: bool = False,
) -> str:
    if error_text:
        return "alert"
    if action_keys or poll_scheduled or poll_follow_up_requested or auto_poll_armed:
        return "busy"
    return "idle"


def normalize_poll_interval_seconds(raw_value: object, default: int = 3, minimum: int = 1, maximum: int = 30) -> int:
    try:
        value = int(raw_value)
    except (TypeError, ValueError):
        return default
    return max(minimum, min(maximum, value))


def asset_ready_jobs(jobs: Sequence[Any], limit: int = 6, job_type_filter: str = "all") -> list[Any]:
    if limit <= 0:
        return []
    normalized_filter = job_type_filter if job_type_filter in {"all", "character", "tileset"} else "all"
    return [
        job
        for job in jobs
        if (getattr(job, "preview_url", "") or getattr(job, "download_url", "") or getattr(job, "status", "") == "ready")
        and (normalized_filter == "all" or getattr(job, "job_type", "") == normalized_filter)
    ][:limit]


def matches_style_preset(job: Any, preset: str = DEFAULT_SERVER_STYLE_PRESET) -> bool:
    normalized = normalize_server_style_preset(preset)
    haystack = " ".join(
        str(getattr(job, field, ""))
        for field in ("prompt", "asset_name", "detail", "label")
    ).lower()
    marker = str(SERVER_STYLE_PRESETS[normalized]["marker"])
    if marker in haystack:
        return True
    return any(keyword in haystack for keyword in SERVER_STYLE_PRESETS[normalized]["keywords"])


def is_graph_style_job(job: Any) -> bool:
    return matches_style_preset(job, DEFAULT_SERVER_STYLE_PRESET)


def choose_asset_job(
    jobs: Sequence[Any],
    selected_job_id: str = "",
    job_type_filter: str = "all",
    preferred_style_preset: str = DEFAULT_SERVER_STYLE_PRESET,
) -> Any | None:
    candidates = asset_ready_jobs(jobs, limit=len(jobs), job_type_filter=job_type_filter)
    if selected_job_id:
        for job in candidates:
            if getattr(job, "job_id", "") == selected_job_id:
                return job
    if job_type_filter == "all":
        for job in candidates:
            if getattr(job, "job_type", "") == "tileset" and matches_style_preset(job, preferred_style_preset):
                return job
        for job in candidates:
            if getattr(job, "job_type", "") == "tileset":
                return job
    for job in candidates:
        if matches_style_preset(job, preferred_style_preset):
            return job
    return candidates[0] if candidates else None


def asset_ready_counts(jobs: Sequence[Any]) -> dict[str, int]:
    counts = {
        "all": 0,
        "character": 0,
        "tileset": 0,
    }
    for job in asset_ready_jobs(jobs, limit=len(jobs), job_type_filter="all"):
        counts["all"] += 1
        job_type = getattr(job, "job_type", "")
        if job_type in counts:
            counts[job_type] += 1
    return counts


def summarize_asset_history_entry(job: Any, max_length: int = 30) -> str:
    label = getattr(job, "label", "Asset")
    status = getattr(job, "status", "")
    summary = getattr(job, "asset_name", "") or getattr(job, "prompt", "") or getattr(job, "detail", "") or label
    if len(summary) > max_length:
        summary = f"{summary[: max_length - 3].rstrip()}..."
    return f"[{status}] {summary}"


def summarize_tracked_job_entry(job: Any, max_length: int = 42) -> str:
    status = getattr(job, "status", "")
    job_type = getattr(job, "job_type", "job")
    summary = getattr(job, "asset_name", "") or getattr(job, "prompt", "") or getattr(job, "detail", "") or getattr(job, "label", "Job")
    if len(summary) > max_length:
        summary = f"{summary[: max_length - 3].rstrip()}..."
    return f"[{status}] {job_type} | {summary}"


def _compact_detail_value(value: Any, max_length: int | None = 84) -> str:
    text = str(value or "")
    if max_length is None:
        return text
    text = " ".join(text.split())
    if len(text) <= max_length:
        return text
    return f"{text[: max_length - 3].rstrip()}..."


def build_tracked_job_detail(job: Any, compact: bool = True) -> str:
    max_length = 84 if compact else None
    lines = [
        f"Type: {getattr(job, 'job_type', '')}",
        f"Status: {getattr(job, 'status', '')}",
        f"Source: {getattr(job, 'source', '')}",
        f"Prompt: {_compact_detail_value(getattr(job, 'prompt', ''), max_length)}",
    ]
    detail = getattr(job, "detail", "")
    if detail:
        lines.append(f"Detail: {_compact_detail_value(detail, max_length)}")
    asset_name = getattr(job, "asset_name", "")
    if asset_name:
        lines.append(f"Asset: {_compact_detail_value(asset_name, max_length)}")
    preview_url = getattr(job, "preview_url", "")
    if preview_url:
        lines.append(f"Preview: {_compact_detail_value(preview_url, max_length)}")
    download_url = getattr(job, "download_url", "")
    if download_url:
        lines.append(f"Download: {_compact_detail_value(download_url, max_length)}")
    return "\n".join(lines)


def cache_refresh_targets(preview_url: str, download_url: str) -> list[tuple[str, str]]:
    targets: list[tuple[str, str]] = []
    preview_target = choose_preview_url(preview_url, download_url)
    if preview_target:
        targets.append(("preview", preview_target))
    if download_url:
        targets.append(("download", download_url))
    return targets


def should_apply_preview_result(active_request_id: int, result_request_id: int, active_url: str, result_url: str) -> bool:
    return bool(result_url) and active_request_id == result_request_id and active_url == result_url


def build_asset_link_text(preview_url: str, download_url: str) -> str:
    lines: list[str] = []
    if preview_url:
        lines.append(f"Preview: {preview_url}")
    if download_url:
        lines.append(f"Download: {download_url}")
    return "\n".join(lines)


def should_reload_preview(current_url: str, next_url: str, has_image: bool) -> bool:
    if not next_url:
        return False
    if not has_image:
        return True
    return current_url != next_url