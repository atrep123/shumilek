from __future__ import annotations

import hashlib
import http.client
import ipaddress
import json
import mimetypes
from pathlib import Path
import shutil
import socket
import ssl
import tempfile
import time
from urllib import parse as urlparse
from urllib import request as urlrequest


DEFAULT_ASSET_REQUEST_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ShumilekUI/1.0",
}
BOOTSTRAP_VISUAL_STATE_FILE = "last_visual.json"
BOOTSTRAP_VISUAL_MAX_AGE_SECONDS = 300


def _asset_digest(url: str) -> str:
    return hashlib.sha1(url.encode("utf-8")).hexdigest()[:16]


def get_asset_cache_dir(base_dir: Path | None = None) -> Path:
    root = base_dir or Path(tempfile.gettempdir()) / "shumilek_ui_assets"
    root.mkdir(parents=True, exist_ok=True)
    return root


def cached_asset_path(url: str, cache_dir: Path | None = None, content_type: str = "application/octet-stream") -> Path:
    parsed = urlparse.urlparse(url)
    suffix = Path(parsed.path).suffix
    if not suffix:
        guessed = mimetypes.guess_extension(content_type.split(";", 1)[0].strip())
        suffix = guessed or ".bin"
    digest = _asset_digest(url)
    return get_asset_cache_dir(cache_dir) / f"{digest}{suffix}"


def _is_public_download_host(hostname: str) -> bool:
    """Return False for loopback, private, and link-local addresses."""
    if not hostname:
        return False
    try:
        addr_info = socket.getaddrinfo(hostname, None, socket.AF_UNSPEC, socket.SOCK_STREAM)
    except socket.gaierror:
        return False
    for _family, _type, _proto, _canonname, sockaddr in addr_info:
        ip_str = sockaddr[0]
        if ip_str.startswith("::ffff:"):
            ip_str = ip_str[7:]
        try:
            addr = ipaddress.ip_address(ip_str)
        except ValueError:
            continue
        if addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved:
            return False
    return True


def _download_with_auth_redirect(url: str, auth_headers: dict[str, str] | None = None, timeout: int = 5) -> tuple[bytes, str]:
    """Download url, sending auth_headers only to api.pixellab.ai, stripping on CDN redirect."""
    parsed = urlparse.urlparse(url)
    for _ in range(5):
        if parsed.scheme not in ("http", "https"):
            raise ValueError(f"Unsupported scheme: {parsed.scheme}")
        if not _is_public_download_host(parsed.hostname or ""):
            raise ValueError(f"Download blocked: {parsed.hostname} is not a public host")
        use_ssl = parsed.scheme == "https"
        conn: http.client.HTTPConnection
        if use_ssl:
            conn = http.client.HTTPSConnection(parsed.hostname or "", parsed.port or 443, context=ssl.create_default_context(), timeout=timeout)
        else:
            conn = http.client.HTTPConnection(parsed.hostname or "", parsed.port or 80, timeout=timeout)
        try:
            path = parsed.path
            if parsed.query:
                path += "?" + parsed.query
            headers = dict(DEFAULT_ASSET_REQUEST_HEADERS)
            if auth_headers and "api.pixellab.ai" in (parsed.hostname or ""):
                headers.update(auth_headers)
            conn.request("GET", path, headers=headers)
            resp = conn.getresponse()
            if resp.status in (301, 302, 303, 307, 308):
                location = resp.getheader("Location", "")
                if not location:
                    raise ValueError("Redirect without Location header")
                parsed = urlparse.urlparse(location)
                continue
            if resp.status != 200:
                raise ValueError(f"HTTP {resp.status} downloading {url}")
            data = resp.read()
            content_type = resp.getheader("Content-Type", "application/octet-stream")
            return data, content_type
        finally:
            conn.close()
    raise ValueError("Too many redirects")


def ensure_asset_cached(url: str, cache_dir: Path | None = None, timeout: int = 5, force_refresh: bool = False, auth_headers: dict[str, str] | None = None) -> tuple[Path, bool]:
    resolved_cache_dir = get_asset_cache_dir(cache_dir)
    digest = _asset_digest(url)
    existing = next(resolved_cache_dir.glob(f"{digest}.*"), None)
    if existing is not None and not force_refresh:
        return existing, False
    if existing is not None and force_refresh:
        for stale_path in resolved_cache_dir.glob(f"{digest}.*"):
            stale_path.unlink(missing_ok=True)

    if auth_headers:
        payload, content_type = _download_with_auth_redirect(url, auth_headers, timeout)
    else:
        request = urlrequest.Request(url, headers=DEFAULT_ASSET_REQUEST_HEADERS)
        with urlrequest.urlopen(request, timeout=timeout) as response:
            content_type = response.headers.get_content_type()
            payload = response.read()
    target = cached_asset_path(url, cache_dir=resolved_cache_dir, content_type=content_type)
    target.write_bytes(payload)
    return target, True


def browser_url_for_path(path: Path) -> str:
    return path.resolve().as_uri()


def suggested_asset_name(url: str, fallback_name: str = "asset") -> str:
    parsed = urlparse.urlparse(url)
    candidate = Path(parsed.path).name
    if candidate:
        return candidate
    return fallback_name


def export_cached_asset(source_path: Path, destination_path: Path) -> Path:
    destination_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source_path, destination_path)
    return destination_path


def save_visual_bootstrap_state(
    cached_path: Path,
    *,
    preview_url: str = "",
    download_url: str = "",
    job_type: str = "",
    title: str = "",
    subtitle: str = "",
    cache_dir: Path | None = None,
) -> Path:
    target = get_asset_cache_dir(cache_dir) / BOOTSTRAP_VISUAL_STATE_FILE
    payload = {
        "cached_path": str(cached_path),
        "preview_url": str(preview_url),
        "download_url": str(download_url),
        "job_type": str(job_type),
        "title": str(title),
        "subtitle": str(subtitle),
        "saved_at": time.time(),
    }
    target.write_text(json.dumps(payload), encoding="utf-8")
    return target


def _inspect_visual_bootstrap_state(cache_dir: Path | None = None, max_age_seconds: int = BOOTSTRAP_VISUAL_MAX_AGE_SECONDS) -> tuple[dict[str, str] | None, str | None]:
    source = get_asset_cache_dir(cache_dir) / BOOTSTRAP_VISUAL_STATE_FILE
    if not source.exists():
        return None, None
    try:
        payload = json.loads(source.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return None, "state file is unreadable"
    if not isinstance(payload, dict):
        return None, "state payload is not an object"

    saved_at = payload.get("saved_at")
    if not isinstance(saved_at, (int, float)):
        return None, "state is missing saved_at"
    if max_age_seconds >= 0 and (time.time() - float(saved_at)) > max_age_seconds:
        return None, "state is stale"

    cached_path = Path(str(payload.get("cached_path") or "").strip())
    if not str(cached_path) or not cached_path.exists():
        return None, "cached asset is missing"

    return {
        "cached_path": str(cached_path),
        "preview_url": str(payload.get("preview_url") or "").strip(),
        "download_url": str(payload.get("download_url") or "").strip(),
        "job_type": str(payload.get("job_type") or "").strip(),
        "title": str(payload.get("title") or "").strip(),
        "subtitle": str(payload.get("subtitle") or "").strip(),
    }, None


def load_visual_bootstrap_state(cache_dir: Path | None = None, max_age_seconds: int = BOOTSTRAP_VISUAL_MAX_AGE_SECONDS) -> dict[str, str] | None:
    payload, _reason = _inspect_visual_bootstrap_state(cache_dir=cache_dir, max_age_seconds=max_age_seconds)
    return payload


def describe_visual_bootstrap_state_issue(cache_dir: Path | None = None, max_age_seconds: int = BOOTSTRAP_VISUAL_MAX_AGE_SECONDS) -> str | None:
    _payload, reason = _inspect_visual_bootstrap_state(cache_dir=cache_dir, max_age_seconds=max_age_seconds)
    return reason