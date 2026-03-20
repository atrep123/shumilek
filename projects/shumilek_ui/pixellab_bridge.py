from __future__ import annotations

from dataclasses import dataclass, replace
import json
import os
from pathlib import Path
import re
import threading
from typing import Any, Callable
from urllib import error as urlerror
from urllib import request as urlrequest
import uuid


ToolFn = Callable[..., Any]
BRIDGE_MANIFEST_ENV = "SHUMILEK_PIXELLAB_BRIDGE_MANIFEST"
REMOTE_MCP_PROTOCOL_VERSION = "2025-03-26"
REMOTE_MCP_HTTP_TIMEOUT_SECONDS = 20


def _candidate_manifest_paths() -> list[Path]:
    candidates: list[Path] = []
    env_path = os.environ.get(BRIDGE_MANIFEST_ENV, "").strip()
    if env_path:
        candidates.append(Path(env_path))

    base_dir = Path(__file__).resolve().parent
    candidates.append(base_dir / ".pixellab-bridge.json")
    return candidates


def _candidate_remote_mcp_paths() -> list[Path]:
    base_dir = Path(__file__).resolve().parent
    candidates = [
        base_dir.parent.parent / ".vscode" / "mcp.json",
        Path.cwd() / ".vscode" / "mcp.json",
    ]
    unique_candidates: list[Path] = []
    for path in candidates:
        if path not in unique_candidates:
            unique_candidates.append(path)
    return unique_candidates


def _read_json_response(req: urlrequest.Request, timeout: float = 1.5) -> dict[str, Any]:
    with urlrequest.urlopen(req, timeout=timeout) as response:
        raw = response.read().decode("utf-8")
    parsed = json.loads(raw or "{}")
    if not isinstance(parsed, dict):
        raise ValueError("Bridge response must be a JSON object")
    return parsed


def _read_text_response(req: urlrequest.Request) -> str:
    with urlrequest.urlopen(req, timeout=REMOTE_MCP_HTTP_TIMEOUT_SECONDS) as response:
        return response.read().decode("utf-8")


def _parse_mcp_messages(raw: str) -> list[dict[str, Any]]:
    stripped = raw.strip()
    if not stripped:
        return []

    messages: list[dict[str, Any]] = []
    if stripped.startswith("{"):
        parsed = json.loads(stripped)
        if isinstance(parsed, dict):
            return [parsed]
        return []

    buffer: list[str] = []
    for line in raw.splitlines():
        if line.startswith("data:"):
            buffer.append(line[5:].strip())
            continue
        if buffer and not line.strip():
            payload = "\n".join(buffer)
            parsed = json.loads(payload)
            if isinstance(parsed, dict):
                messages.append(parsed)
            buffer = []

    if buffer:
        payload = "\n".join(buffer)
        parsed = json.loads(payload)
        if isinstance(parsed, dict):
            messages.append(parsed)

    return messages


def _read_mcp_result(req: urlrequest.Request) -> dict[str, Any]:
    raw = _read_text_response(req)
    messages = _parse_mcp_messages(raw)
    if not messages:
        raise RuntimeError("PixelLab MCP returned an empty response")

    for message in reversed(messages):
        if isinstance(message.get("result"), dict):
            return message["result"]
        if isinstance(message.get("error"), dict):
            raise RuntimeError(str(message["error"].get("message") or "PixelLab MCP request failed"))

    raise RuntimeError("PixelLab MCP returned no result payload")


def _mcp_post(server_url: str, headers: dict[str, str], payload: dict[str, Any]) -> dict[str, Any]:
    merged_headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        **headers,
    }
    req = urlrequest.Request(
        server_url,
        data=json.dumps(payload).encode("utf-8"),
        headers=merged_headers,
        method="POST",
    )
    return _read_mcp_result(req)


def _initialize_remote_mcp(server_url: str, headers: dict[str, str]) -> None:
    _mcp_post(
        server_url,
        headers,
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": REMOTE_MCP_PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {
                    "name": "shumilek-ui",
                    "version": "1.0.0",
                },
            },
        },
    )


def _list_remote_tools(server_url: str, headers: dict[str, str]) -> set[str]:
    result = _mcp_post(
        server_url,
        headers,
        {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/list",
            "params": {},
        },
    )
    tools = result.get("tools")
    if not isinstance(tools, list):
        return set()
    return {str(item.get("name")) for item in tools if isinstance(item, dict) and item.get("name")}


def _tool_text_content(result: dict[str, Any]) -> str:
    content = result.get("content")
    if not isinstance(content, list):
        return ""

    text_parts: list[str] = []
    for item in content:
        if not isinstance(item, dict):
            continue
        if item.get("type") == "text":
            text = item.get("text")
            if text:
                text_parts.append(str(text))
    return "\n".join(text_parts)


def _extract_markdown_urls(text: str) -> list[str]:
    return [match.group(1) for match in re.finditer(r"\[[^\]]+\]\((https?://[^)]+)\)", text)]


def _extract_backtick_value(text: str, label: str) -> str:
    pattern = re.compile(rf"\*\*{re.escape(label)}:\*\*\s*`([^`]+)`", re.IGNORECASE)
    match = pattern.search(text)
    return match.group(1).strip() if match else ""


def _extract_named_value(text: str, label: str) -> str:
    pattern = re.compile(rf"\*\*{re.escape(label)}:\*\*\s*([^\n`]+)", re.IGNORECASE)
    match = pattern.search(text)
    return match.group(1).strip() if match else ""


def _parse_remote_listing_entries(text: str) -> list[dict[str, str]]:
    entries: list[dict[str, str]] = []
    current: dict[str, str] | None = None
    detail_lines: list[str] = []
    entry_pattern = re.compile(r"^(?P<marker>[✅⏳])\s+\*\*(?P<label>.+?)\*\*\s+`(?P<remote_id>[^`]+)`\s*$")

    def flush_current() -> None:
        nonlocal current, detail_lines
        if current is None:
            return
        explicit_status = ""
        for line in detail_lines:
            lowered = line.lower()
            if lowered.startswith("status:"):
                explicit_status = line.split(":", 1)[1].strip().lower()
                break
        if explicit_status:
            current["status"] = explicit_status
        current["detail"] = " | ".join(detail_lines)
        entries.append(current)
        current = None
        detail_lines = []

    for raw_line in text.splitlines():
        line = raw_line.rstrip()
        match = entry_pattern.match(line.strip())
        if match:
            flush_current()
            marker = match.group("marker")
            current = {
                "remote_id": match.group("remote_id").strip(),
                "label": match.group("label").strip(),
                "status": "processing" if marker == "⏳" else "ready",
            }
            continue
        if current is None:
            continue
        stripped = line.strip()
        if not stripped or stripped.startswith("→ Next:"):
            continue
        if stripped.startswith("-"):
            detail_lines.append(stripped[1:].strip())
        else:
            detail_lines.append(stripped)

    flush_current()
    return entries


def _extract_progress_status(text: str, noun: str) -> str:
    if re.search(rf"{re.escape(noun)}\s+is\s+still\s+being\s+generated", text, re.IGNORECASE):
        return "processing"
    if "Status:" in text:
        status_value = _extract_named_value(text, "Status")
        normalized = status_value.lower()
        if "processing" in normalized:
            return "processing"
        if "ready" in normalized or "completed" in normalized:
            return "ready"
    if "Rotation Images:" in text or "Download:" in text:
        return "ready"
    return "unknown"


def _normalize_remote_tool_result(tool_name: str, result: dict[str, Any]) -> dict[str, Any]:
    text = _tool_text_content(result)
    urls = _extract_markdown_urls(text)

    if tool_name == "create_character":
        return {
            "character_id": _extract_backtick_value(text, "Character ID"),
            "name": _extract_named_value(text, "Name"),
            "status": _extract_progress_status(text, "Character"),
        }

    if tool_name == "get_character":
        preview_url = ""
        for url in urls:
            if "/rotations/" in url or url.endswith(".png"):
                preview_url = url
                break
        download_url = ""
        for url in urls:
            if "/download" in url or url.endswith(".zip"):
                download_url = url
                break
        return {
            "character_id": _extract_backtick_value(text, "ID"),
            "name": _extract_named_value(text, "Character") or _extract_named_value(text, "Name"),
            "status": _extract_progress_status(text, "Character"),
            "preview_url": preview_url,
            "download_url": download_url,
        }

    if tool_name == "create_topdown_tileset":
        return {
            "tileset_id": _extract_backtick_value(text, "Tileset ID"),
            "tileset_name": _extract_named_value(text, "Description"),
            "status": _extract_progress_status(text, "Tileset"),
        }

    if tool_name == "get_topdown_tileset":
        preview_url = ""
        for url in urls:
            if "/image" in url or url.endswith(".png"):
                preview_url = url
                break
        download_url = ""
        for url in urls:
            if "/image" in url or url.endswith(".png") or "/download" in url or url.endswith(".zip") or url.endswith(".json"):
                download_url = url
                break
        return {
            "tileset_id": _extract_backtick_value(text, "Tileset ID") or _extract_backtick_value(text, "ID"),
            "tileset_name": _extract_named_value(text, "Tileset") or _extract_named_value(text, "Description"),
            "status": _extract_progress_status(text, "Tileset"),
            "preview_url": preview_url,
            "download_url": download_url,
        }

    if tool_name in {"list_characters", "list_topdown_tilesets"}:
        return {
            "items": _parse_remote_listing_entries(text),
        }

    return result


def _remote_mcp_tool_call(server_url: str, headers: dict[str, str], tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    result = _mcp_post(
        server_url,
        headers,
        {
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": arguments,
            },
        },
    )
    return _normalize_remote_tool_result(tool_name, result)


def discover_remote_tool_bindings() -> dict[str, ToolFn]:
    for config_path in _candidate_remote_mcp_paths():
        if not config_path.exists():
            continue

        try:
            config = json.loads(config_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue

        if not isinstance(config, dict):
            continue

        servers = config.get("servers")
        if not isinstance(servers, dict):
            continue

        server = servers.get("pixellab")
        if not isinstance(server, dict):
            continue

        server_url = server.get("url")
        if not isinstance(server_url, str) or not server_url.strip():
            continue
        if server.get("type") not in (None, "http"):
            continue

        raw_headers = server.get("headers")
        headers = {str(key): str(value) for key, value in raw_headers.items()} if isinstance(raw_headers, dict) else {}

        try:
            _initialize_remote_mcp(server_url, headers)
            tool_names = _list_remote_tools(server_url, headers)
        except (OSError, ValueError, json.JSONDecodeError, urlerror.URLError, RuntimeError):
            continue

        bindings: dict[str, ToolFn] = {}
        if "create_character" in tool_names:
            bindings["create_character"] = lambda **kwargs: _remote_mcp_tool_call(server_url, headers, "create_character", kwargs)
        if "get_character" in tool_names:
            bindings["get_character"] = lambda **kwargs: _remote_mcp_tool_call(server_url, headers, "get_character", kwargs)
        if "list_characters" in tool_names:
            bindings["list_characters"] = lambda **kwargs: _remote_mcp_tool_call(server_url, headers, "list_characters", kwargs)
        if "create_topdown_tileset" in tool_names:
            bindings["create_topdown_tileset"] = lambda **kwargs: _remote_mcp_tool_call(server_url, headers, "create_topdown_tileset", kwargs)
        if "get_topdown_tileset" in tool_names:
            bindings["get_topdown_tileset"] = lambda **kwargs: _remote_mcp_tool_call(server_url, headers, "get_topdown_tileset", kwargs)
        if "list_topdown_tilesets" in tool_names:
            bindings["list_topdown_tilesets"] = lambda **kwargs: _remote_mcp_tool_call(server_url, headers, "list_topdown_tilesets", kwargs)

        if bindings:
            return bindings

    return {}


def _bridge_healthcheck(base_url: str) -> dict[str, Any] | None:
    try:
        req = urlrequest.Request(f"{base_url.rstrip('/')}/health", headers={"Accept": "application/json"})
        data = _read_json_response(req)
    except (OSError, ValueError, json.JSONDecodeError, urlerror.URLError):
        return None

    if not data.get("ok"):
        return None
    return data


def _bridge_post(base_url: str, endpoint: str, payload: dict[str, Any]) -> dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")
    req = urlrequest.Request(
        f"{base_url.rstrip('/')}{endpoint}",
        data=body,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    data = _read_json_response(req, timeout=REMOTE_MCP_HTTP_TIMEOUT_SECONDS)
    if not data.get("ok"):
        raise RuntimeError(str(data.get("error") or "PixelLab bridge request failed"))
    result = data.get("result")
    if not isinstance(result, dict):
        raise RuntimeError("PixelLab bridge returned an invalid result payload")
    return result


def discover_local_tool_bindings() -> dict[str, ToolFn]:
    for manifest_path in _candidate_manifest_paths():
        if not manifest_path.exists():
            continue

        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue

        if not isinstance(manifest, dict):
            continue

        base_url = manifest.get("baseUrl")
        if not isinstance(base_url, str) or not base_url.strip():
            continue

        health = _bridge_healthcheck(base_url)
        if not health:
            continue

        available_tools = health.get("availableTools")
        if not isinstance(available_tools, list):
            available_tools = []
        tool_names = {str(item) for item in available_tools}
        bindings: dict[str, ToolFn] = {}

        if "create_character" in tool_names:
            bindings["create_character"] = lambda **kwargs: _bridge_post(base_url, "/character/create", kwargs)
        if "get_character" in tool_names:
            bindings["get_character"] = lambda **kwargs: _bridge_post(base_url, "/character/get", kwargs)
        if "create_topdown_tileset" in tool_names:
            bindings["create_topdown_tileset"] = lambda **kwargs: _bridge_post(base_url, "/tileset/create", kwargs)
        if "get_topdown_tileset" in tool_names:
            bindings["get_topdown_tileset"] = lambda **kwargs: _bridge_post(base_url, "/tileset/get", kwargs)

        if bindings:
            return bindings

    return {}


def get_remote_auth_headers() -> dict[str, str]:
    """Return auth headers from .vscode/mcp.json if present."""
    for config_path in _candidate_remote_mcp_paths():
        if not config_path.exists():
            continue
        try:
            config = json.loads(config_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(config, dict):
            continue
        servers = config.get("servers")
        if not isinstance(servers, dict):
            continue
        server = servers.get("pixellab")
        if not isinstance(server, dict):
            continue
        raw_headers = server.get("headers")
        if isinstance(raw_headers, dict):
            return {str(k): str(v) for k, v in raw_headers.items()}
    return {}


def discover_tool_bindings() -> dict[str, ToolFn]:
    bindings = discover_local_tool_bindings()
    if bindings:
        return bindings
    return discover_remote_tool_bindings()


@dataclass(frozen=True)
class PixelLabJob:
    job_id: str
    job_type: str
    label: str
    prompt: str
    status: str
    source: str
    remote_id: str | None = None
    detail: str = ""
    asset_name: str = ""
    preview_url: str = ""
    download_url: str = ""


class PixelLabBridge:
    def __init__(self, tool_bindings: dict[str, ToolFn] | None = None) -> None:
        self.tool_bindings = tool_bindings if tool_bindings is not None else discover_tool_bindings()
        self.jobs: list[PixelLabJob] = []
        self._jobs_lock = threading.Lock()

    @property
    def has_live_tools(self) -> bool:
        return callable(self.tool_bindings.get("create_character")) or callable(self.tool_bindings.get("create_topdown_tileset"))

    def get_mode_label(self) -> str:
        return "live-mcp" if self.has_live_tools else "draft-ready"

    def submit_character(self, description: str, *, n_directions: int = 8, size: int = 48) -> PixelLabJob:
        description = description.strip()
        if not description:
            raise ValueError("Character description is required")

        if callable(self.tool_bindings.get("create_character")):
            result = self.tool_bindings["create_character"](
                description=description,
                n_directions=n_directions,
                size=size,
            )
            remote_id = self._extract_remote_id(result, "character_id")
            asset_meta = self._extract_asset_metadata(result)
            job = PixelLabJob(
                job_id=self._build_job_id("character"),
                job_type="character",
                label="Character queued",
                prompt=description,
                status="queued",
                source="mcp",
                remote_id=remote_id,
                detail=f"directions={n_directions}, size={size}",
                asset_name=asset_meta["asset_name"],
                preview_url=asset_meta["preview_url"],
                download_url=asset_meta["download_url"],
            )
        else:
            job = PixelLabJob(
                job_id=self._build_job_id("character"),
                job_type="character",
                label="Character draft",
                prompt=description,
                status="waiting_for_mcp",
                source="draft",
                detail=f"directions={n_directions}, size={size}",
            )

        with self._jobs_lock:
            self.jobs.insert(0, job)
        return job

    def submit_tileset(self, lower_description: str, upper_description: str, *, tile_size: int = 16) -> PixelLabJob:
        lower_description = lower_description.strip()
        upper_description = upper_description.strip()
        if not lower_description or not upper_description:
            raise ValueError("Both lower and upper tileset descriptions are required")

        prompt = f"{lower_description} -> {upper_description}"
        if callable(self.tool_bindings.get("create_topdown_tileset")):
            result = self.tool_bindings["create_topdown_tileset"](
                lower_description=lower_description,
                upper_description=upper_description,
                tile_size={"width": tile_size, "height": tile_size},
            )
            remote_id = self._extract_remote_id(result, "tileset_id")
            asset_meta = self._extract_asset_metadata(result)
            job = PixelLabJob(
                job_id=self._build_job_id("tileset"),
                job_type="tileset",
                label="Tileset queued",
                prompt=prompt,
                status="queued",
                source="mcp",
                remote_id=remote_id,
                detail=f"tile={tile_size}x{tile_size}",
                asset_name=asset_meta["asset_name"],
                preview_url=asset_meta["preview_url"],
                download_url=asset_meta["download_url"],
            )
        else:
            job = PixelLabJob(
                job_id=self._build_job_id("tileset"),
                job_type="tileset",
                label="Tileset draft",
                prompt=prompt,
                status="waiting_for_mcp",
                source="draft",
                detail=f"tile={tile_size}x{tile_size}",
            )

        with self._jobs_lock:
            self.jobs.insert(0, job)
        return job

    def refresh_jobs(self) -> list[PixelLabJob]:
        with self._jobs_lock:
            jobs = list(self.jobs)

        jobs = self._merge_imported_remote_jobs(jobs)

        refreshed: list[PixelLabJob] = []
        for job in jobs:
            refreshed.append(self._refresh_job(job))
        with self._jobs_lock:
            self.jobs = refreshed
            return list(self.jobs)

    def seed_jobs_for_ui(self) -> list[PixelLabJob]:
        with self._jobs_lock:
            jobs = list(self.jobs)

        imported_jobs: list[PixelLabJob] = []
        if callable(self.tool_bindings.get("list_characters")):
            result = self.tool_bindings["list_characters"]()
            imported_jobs.extend(self._build_imported_jobs(result, "character", "Character queued"))

        if imported_jobs:
            jobs = self._merge_jobs(jobs, imported_jobs)

        for job in jobs:
            if job.job_type != "character" or not job.remote_id:
                continue
            if not callable(self.tool_bindings.get("get_character")):
                break
            try:
                result = self.tool_bindings["get_character"](character_id=job.remote_id, include_preview=True)
            except (OSError, RuntimeError, ValueError, urlerror.URLError, TimeoutError):
                break
            status = self._extract_status(result)
            asset_meta = self._extract_asset_metadata(result)
            enriched = replace(
                job,
                status=status,
                detail=self._merge_detail(job.detail, result),
                asset_name=asset_meta["asset_name"] or job.asset_name,
                preview_url=asset_meta["preview_url"] or job.preview_url,
                download_url=asset_meta["download_url"] or job.download_url,
            )
            jobs = [enriched if candidate.job_id == job.job_id else candidate for candidate in jobs]
            break

        with self._jobs_lock:
            self.jobs = jobs
            return list(self.jobs)

    def seed_tileset_jobs_for_ui(self) -> list[PixelLabJob]:
        with self._jobs_lock:
            jobs = list(self.jobs)

        imported_jobs: list[PixelLabJob] = []
        if callable(self.tool_bindings.get("list_topdown_tilesets")):
            result = self.tool_bindings["list_topdown_tilesets"]()
            imported_jobs.extend(self._build_imported_jobs(result, "tileset", "Tileset queued"))

        if imported_jobs:
            jobs = self._merge_jobs(jobs, imported_jobs)

        with self._jobs_lock:
            self.jobs = jobs
            return list(self.jobs)

    def list_jobs(self) -> list[PixelLabJob]:
        with self._jobs_lock:
            return list(self.jobs)

    def _merge_imported_remote_jobs(self, jobs: list[PixelLabJob]) -> list[PixelLabJob]:
        imported_jobs: list[PixelLabJob] = []

        if callable(self.tool_bindings.get("list_characters")):
            result = self.tool_bindings["list_characters"]()
            imported_jobs.extend(self._build_imported_jobs(result, "character", "Character queued"))
        if callable(self.tool_bindings.get("list_topdown_tilesets")):
            result = self.tool_bindings["list_topdown_tilesets"]()
            imported_jobs.extend(self._build_imported_jobs(result, "tileset", "Tileset queued"))

        if not imported_jobs:
            return jobs

        return self._merge_jobs(jobs, imported_jobs)

    def _merge_jobs(self, jobs: list[PixelLabJob], imported_jobs: list[PixelLabJob]) -> list[PixelLabJob]:
        if not imported_jobs:
            return list(jobs)

        merged = list(jobs)
        existing_by_remote = {
            (job.job_type, job.remote_id): index
            for index, job in enumerate(merged)
            if job.remote_id
        }
        for imported in imported_jobs:
            key = (imported.job_type, imported.remote_id)
            existing_index = existing_by_remote.get(key)
            if existing_index is None:
                merged.append(imported)
                existing_by_remote[key] = len(merged) - 1
                continue
            current = merged[existing_index]
            merged[existing_index] = replace(
                current,
                status=imported.status or current.status,
                detail=imported.detail or current.detail,
                asset_name=imported.asset_name or current.asset_name,
                prompt=imported.prompt or current.prompt,
                preview_url=imported.preview_url or current.preview_url,
                download_url=imported.download_url or current.download_url,
            )
        return merged

    def _build_imported_jobs(self, result: Any, job_type: str, label: str) -> list[PixelLabJob]:
        if not isinstance(result, dict):
            return []
        items = result.get("items")
        if not isinstance(items, list):
            return []

        imported: list[PixelLabJob] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            remote_id = str(item.get("remote_id") or "").strip()
            if not remote_id:
                continue
            prompt = str(item.get("label") or item.get("prompt") or "").strip()
            detail = str(item.get("detail") or "").strip()
            status = str(item.get("status") or "unknown").strip().lower()
            preview_url = ""
            download_url = ""
            if job_type == "tileset" and status == "ready":
                preview_url = f"https://api.pixellab.ai/mcp/tilesets/{remote_id}/image"
                download_url = preview_url
            imported.append(
                PixelLabJob(
                    job_id=self._build_job_id(job_type),
                    job_type=job_type,
                    label=label,
                    prompt=prompt,
                    status=status,
                    source="mcp",
                    remote_id=remote_id,
                    detail=detail,
                    asset_name=prompt,
                    preview_url=preview_url,
                    download_url=download_url,
                )
            )
        return imported

    def _refresh_job(self, job: PixelLabJob) -> PixelLabJob:
        if job.source != "mcp" or not job.remote_id:
            return job

        if str(job.status).strip().lower() == "ready" and (job.preview_url or job.download_url):
            return job

        if job.job_type == "character" and callable(self.tool_bindings.get("get_character")):
            result = self.tool_bindings["get_character"](character_id=job.remote_id, include_preview=True)
            status = self._extract_status(result)
            asset_meta = self._extract_asset_metadata(result)
            return replace(
                job,
                status=status,
                detail=self._merge_detail(job.detail, result),
                asset_name=asset_meta["asset_name"] or job.asset_name,
                preview_url=asset_meta["preview_url"] or job.preview_url,
                download_url=asset_meta["download_url"] or job.download_url,
            )

        if job.job_type == "tileset" and callable(self.tool_bindings.get("get_topdown_tileset")):
            result = self.tool_bindings["get_topdown_tileset"](tileset_id=job.remote_id)
            status = self._extract_status(result)
            asset_meta = self._extract_asset_metadata(result)
            return replace(
                job,
                status=status,
                detail=self._merge_detail(job.detail, result),
                asset_name=asset_meta["asset_name"] or job.asset_name,
                preview_url=asset_meta["preview_url"] or job.preview_url,
                download_url=asset_meta["download_url"] or job.download_url,
            )

        return job

    def _build_job_id(self, prefix: str) -> str:
        return f"{prefix}-{uuid.uuid4().hex[:8]}"

    def _extract_remote_id(self, result: Any, key: str) -> str | None:
        if isinstance(result, dict):
            value = result.get(key)
            return None if value is None else str(value)
        value = getattr(result, key, None)
        return None if value is None else str(value)

    def _extract_status(self, result: Any) -> str:
        if isinstance(result, dict):
            for key in ("status", "state", "job_status"):
                value = result.get(key)
                if value:
                    return str(value)
            jobs = result.get("pending_jobs")
            if jobs:
                return "processing"
            animations = result.get("animations")
            if animations is not None:
                return "ready"
            return "unknown"
        for key in ("status", "state", "job_status"):
            value = getattr(result, key, None)
            if value:
                return str(value)
        return "unknown"

    def _merge_detail(self, existing: str, result: Any) -> str:
        if isinstance(result, dict):
            preview_keys = []
            asset_meta = self._extract_asset_metadata(result)
            if asset_meta["download_url"]:
                preview_keys.append(f"download_url={asset_meta['download_url']}")
            if asset_meta["preview_url"]:
                preview_keys.append(f"preview_url={asset_meta['preview_url']}")
            if asset_meta["asset_name"]:
                preview_keys.append(f"name={asset_meta['asset_name']}")
            if preview_keys:
                return existing + " | " + ", ".join(preview_keys)
        return existing

    def _extract_asset_metadata(self, result: Any) -> dict[str, str]:
        if not isinstance(result, dict):
            return {
                "asset_name": "",
                "preview_url": "",
                "download_url": "",
            }

        asset_name = ""
        for key in ("name", "character_name", "tileset_name", "title"):
            value = result.get(key)
            if value:
                asset_name = str(value)
                break

        preview_url = ""
        for key in ("preview_url", "preview", "thumbnail_url", "image_url"):
            value = result.get(key)
            if value:
                preview_url = str(value)
                break

        download_url = ""
        for key in ("download_url", "asset_url", "url"):
            value = result.get(key)
            if value:
                download_url = str(value)
                break

        return {
            "asset_name": asset_name,
            "preview_url": preview_url,
            "download_url": download_url,
        }