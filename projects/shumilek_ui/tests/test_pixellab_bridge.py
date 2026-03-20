import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
from pathlib import Path
import tempfile
import threading
import unittest
from unittest import mock

from projects.shumilek_ui.pixellab_bridge import (
    BRIDGE_MANIFEST_ENV,
    PixelLabBridge,
    PixelLabJob,
    _extract_backtick_value,
    _extract_markdown_urls,
    _extract_named_value,
    _extract_progress_status,
    _normalize_remote_tool_result,
    _parse_mcp_messages,
    _parse_remote_listing_entries,
    _tool_text_content,
    discover_remote_tool_bindings,
)


class _BridgeHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        if self.path != "/health":
            self.send_response(404)
            self.end_headers()
            return
        self._write_json({
            "ok": True,
            "availableTools": ["create_character", "get_character"],
        })

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length", "0"))
        payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        if self.path == "/character/create":
            self._write_json({"ok": True, "result": {"character_id": "bridge-char-1", "echo": payload}})
            return
        if self.path == "/character/get":
            self._write_json(
                {
                    "ok": True,
                    "result": {
                        "status": "ready",
                        "name": "Bridge druid",
                        "preview_url": "https://example.invalid/bridge.png",
                        "download_url": "https://example.invalid/bridge.zip",
                    },
                }
            )
            return
        self.send_response(404)
        self.end_headers()

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        return

    def _write_json(self, payload: dict[str, object]) -> None:
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


class PixelLabBridgeTests(unittest.TestCase):
    def test_auto_discovers_local_bridge_manifest(self) -> None:
        server = ThreadingHTTPServer(("127.0.0.1", 0), _BridgeHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()

        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                manifest_path = Path(temp_dir) / ".pixellab-bridge.json"
                manifest_path.write_text(
                    json.dumps(
                        {
                            "baseUrl": f"http://127.0.0.1:{server.server_port}",
                            "mode": "live-mcp",
                        }
                    ),
                    encoding="utf-8",
                )

                with mock.patch.dict(os.environ, {BRIDGE_MANIFEST_ENV: str(manifest_path)}):
                    bridge = PixelLabBridge()
                    job = bridge.submit_character("bridge druid")
                    jobs = bridge.refresh_jobs()

                self.assertEqual(bridge.get_mode_label(), "live-mcp")
                self.assertEqual(job.source, "mcp")
                self.assertEqual(job.remote_id, "bridge-char-1")
                self.assertEqual(jobs[0].status, "ready")
                self.assertEqual(jobs[0].asset_name, "Bridge druid")
                self.assertEqual(jobs[0].preview_url, "https://example.invalid/bridge.png")
                self.assertEqual(jobs[0].download_url, "https://example.invalid/bridge.zip")
        finally:
            server.shutdown()
            server.server_close()

    def test_offline_character_submit_creates_draft_job(self) -> None:
        with mock.patch("projects.shumilek_ui.pixellab_bridge.discover_tool_bindings", return_value={}):
            bridge = PixelLabBridge()
            job = bridge.submit_character("forest archivist")

        self.assertEqual(job.source, "draft")
        self.assertEqual(job.status, "waiting_for_mcp")
        self.assertEqual(len(bridge.list_jobs()), 1)

    def test_auto_discovers_remote_mcp_config(self) -> None:
        mcp_payloads: list[dict[str, object]] = []

        class _FakeResponse:
            def __init__(self, body: str) -> None:
                self._body = body.encode("utf-8")

            def read(self) -> bytes:
                return self._body

            def __enter__(self) -> "_FakeResponse":
                return self

            def __exit__(self, exc_type, exc, tb) -> None:
                return None

        def fake_urlopen(req, timeout=0):
            del timeout
            payload = json.loads(req.data.decode("utf-8"))
            mcp_payloads.append(payload)
            method = payload["method"]
            if method == "initialize":
                body = "event: message\ndata: " + json.dumps({"jsonrpc": "2.0", "id": 1, "result": {"protocolVersion": "2025-03-26"}}) + "\n\n"
                return _FakeResponse(body)
            if method == "tools/list":
                body = "event: message\ndata: " + json.dumps({"jsonrpc": "2.0", "id": 2, "result": {"tools": [{"name": "create_character"}, {"name": "get_character"}, {"name": "list_characters"}]}}) + "\n\n"
                return _FakeResponse(body)
            if method == "tools/call":
                tool_name = payload["params"]["name"]
                if tool_name == "create_character":
                    body = "event: message\ndata: " + json.dumps({"jsonrpc": "2.0", "id": 3, "result": {"content": [{"type": "text", "text": "**Character ID:** `remote-char-1`\n**Name:** Moss wizard\n**Status:** Processing in background"}]}}) + "\n\n"
                    return _FakeResponse(body)
                if tool_name == "list_characters":
                    body = "event: message\ndata: " + json.dumps({"jsonrpc": "2.0", "id": 3, "result": {"content": [{"type": "text", "text": "📋 Your Characters (1 shown)\n\n✅ **Moss wizard** `remote-char-1`\n    - 8 directions • 48×48"}]}}) + "\n\n"
                    return _FakeResponse(body)
                body = "event: message\ndata: " + json.dumps({"jsonrpc": "2.0", "id": 3, "result": {"content": [{"type": "text", "text": "**Character:** Moss wizard\n**ID:** `remote-char-1`\n\n**Rotation Images:**\n- [south](https://example.invalid/south.png)\n\n**Download:** [Download as ZIP](https://example.invalid/character.zip)"}]}}) + "\n\n"
                return _FakeResponse(body)
            raise AssertionError(f"Unexpected MCP method: {method}")

        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            vscode_dir = repo_root / ".vscode"
            vscode_dir.mkdir(parents=True, exist_ok=True)
            (vscode_dir / "mcp.json").write_text(
                json.dumps(
                    {
                        "servers": {
                            "pixellab": {
                                "url": "https://api.pixellab.ai/mcp",
                                "type": "http",
                                "headers": {"Authorization": "Bearer test-token"},
                            }
                        }
                    }
                ),
                encoding="utf-8",
            )

            target_path = repo_root / "projects" / "shumilek_ui" / "pixellab_bridge.py"
            target_path.parent.mkdir(parents=True, exist_ok=True)
            target_path.write_text("# shim", encoding="utf-8")

            with mock.patch("projects.shumilek_ui.pixellab_bridge.Path.cwd", return_value=repo_root), \
                mock.patch("projects.shumilek_ui.pixellab_bridge.Path.resolve", return_value=target_path), \
                mock.patch("projects.shumilek_ui.pixellab_bridge.urlrequest.urlopen", side_effect=fake_urlopen):
                bindings = discover_remote_tool_bindings()
                bridge = PixelLabBridge(bindings)
                job = bridge.submit_character("moss wizard")
                jobs = bridge.refresh_jobs()

        self.assertTrue(callable(bindings["create_character"]))
        self.assertTrue(callable(bindings["list_characters"]))
        self.assertEqual(job.remote_id, "remote-char-1")
        self.assertEqual(job.source, "mcp")
        self.assertEqual(jobs[0].status, "ready")
        self.assertEqual(jobs[0].preview_url, "https://example.invalid/south.png")
        self.assertEqual(jobs[0].download_url, "https://example.invalid/character.zip")
        self.assertEqual([payload["method"] for payload in mcp_payloads[:2]], ["initialize", "tools/list"])

    def test_refresh_jobs_imports_remote_characters_and_tilesets(self) -> None:
        get_tileset_calls = 0

        def list_characters(**_kwargs):
            return {
                "items": [
                    {
                        "remote_id": "remote-char-1",
                        "label": "graph navigator operator",
                        "status": "processing",
                        "detail": "Creating 8-directions | Progress: 5% (~90s remaining)",
                    }
                ]
            }

        def get_character(**kwargs):
            self.assertEqual(kwargs["character_id"], "remote-char-1")
            return {
                "status": "ready",
                "name": "graph navigator operator",
                "preview_url": "https://example.invalid/char.png",
                "download_url": "https://example.invalid/char.zip",
            }

        def list_topdown_tilesets(**_kwargs):
            return {
                "items": [
                    {
                        "remote_id": "remote-tile-1",
                        "label": "dark topology grid -> cyan teal node lattice",
                        "status": "ready",
                        "detail": "dark topology grid: `lower-1` | cyan teal node lattice: `upper-1`",
                    }
                ]
            }

        def get_topdown_tileset(**kwargs):
            nonlocal get_tileset_calls
            get_tileset_calls += 1
            self.assertEqual(kwargs["tileset_id"], "remote-tile-1")
            return {
                "status": "ready",
                "tileset_name": "dark topology grid -> cyan teal node lattice",
                "preview_url": "https://example.invalid/tile.png",
                "download_url": "https://example.invalid/tile.zip",
            }

        bridge = PixelLabBridge(
            {
                "list_characters": list_characters,
                "get_character": get_character,
                "list_topdown_tilesets": list_topdown_tilesets,
                "get_topdown_tileset": get_topdown_tileset,
            }
        )

        jobs = bridge.refresh_jobs()

        self.assertEqual(len(jobs), 2)
        self.assertEqual({job.remote_id for job in jobs}, {"remote-char-1", "remote-tile-1"})
        character = next(job for job in jobs if job.job_type == "character")
        tileset = next(job for job in jobs if job.job_type == "tileset")
        self.assertEqual(character.status, "ready")
        self.assertEqual(character.preview_url, "https://example.invalid/char.png")
        self.assertEqual(tileset.status, "ready")
        self.assertEqual(tileset.preview_url, "https://api.pixellab.ai/mcp/tilesets/remote-tile-1/image")
        self.assertEqual(tileset.download_url, "https://api.pixellab.ai/mcp/tilesets/remote-tile-1/image")
        self.assertEqual(get_tileset_calls, 0)

    def test_live_character_submit_uses_bound_tool(self) -> None:
        calls: list[dict[str, object]] = []

        def create_character(**kwargs):
            calls.append(kwargs)
            return {"character_id": "char-123"}

        def get_character(**kwargs):
            self.assertEqual(kwargs["character_id"], "char-123")
            return {
                "status": "ready",
                "name": "Moss wizard",
                "preview_url": "https://example.invalid/character.png",
                "download_url": "https://example.invalid/character.zip",
            }

        bridge = PixelLabBridge({
            "create_character": create_character,
            "get_character": get_character,
        })
        job = bridge.submit_character("moss wizard", n_directions=4, size=32)
        jobs = bridge.refresh_jobs()

        self.assertEqual(job.source, "mcp")
        self.assertEqual(job.remote_id, "char-123")
        self.assertEqual(calls[0]["description"], "moss wizard")
        self.assertEqual(calls[0]["n_directions"], 4)
        self.assertEqual(calls[0]["size"], 32)
        self.assertEqual(jobs[0].status, "ready")
        self.assertEqual(jobs[0].asset_name, "Moss wizard")
        self.assertEqual(jobs[0].preview_url, "https://example.invalid/character.png")
        self.assertEqual(jobs[0].download_url, "https://example.invalid/character.zip")
        self.assertIn("download_url", jobs[0].detail)

    def test_refresh_job_skips_ready_mcp_job_without_detail_fetch(self) -> None:
        def get_character(**_kwargs):
            raise AssertionError("ready job should not fetch detail")

        bridge = PixelLabBridge({
            "get_character": get_character,
        })
        ready_job = bridge._refresh_job(
            PixelLabJob(
                job_id="character-ready-1",
                job_type="character",
                label="Character queued",
                prompt="moss wizard",
                status="ready",
                source="mcp",
                remote_id="char-1",
                preview_url="https://example.invalid/character.png",
            )
        )
        self.assertEqual(ready_job.status, "ready")

    def test_seed_jobs_for_ui_imports_characters_and_enriches_first_preview(self) -> None:
        def list_characters(**_kwargs):
            return {
                "items": [
                    {
                        "remote_id": "remote-char-1",
                        "label": "graph navigator operator",
                        "status": "ready",
                        "detail": "8 directions",
                    }
                ]
            }

        def get_character(**kwargs):
            self.assertEqual(kwargs["character_id"], "remote-char-1")
            return {
                "status": "ready",
                "name": "graph navigator operator",
                "preview_url": "https://example.invalid/char.png",
                "download_url": "https://example.invalid/char.zip",
            }

        bridge = PixelLabBridge({
            "list_characters": list_characters,
            "get_character": get_character,
        })

        jobs = bridge.seed_jobs_for_ui()

        self.assertEqual(len(jobs), 1)
        self.assertEqual(jobs[0].preview_url, "https://example.invalid/char.png")
        self.assertEqual(jobs[0].download_url, "https://example.invalid/char.zip")

    def test_seed_tileset_jobs_for_ui_imports_ready_tilesets(self) -> None:
        def list_topdown_tilesets(**_kwargs):
            return {
                "items": [
                    {
                        "remote_id": "remote-tile-1",
                        "label": "dark topology grid -> cyan teal node lattice",
                        "status": "ready",
                        "detail": "lower-1 | upper-1",
                    }
                ]
            }

        bridge = PixelLabBridge({
            "list_topdown_tilesets": list_topdown_tilesets,
        })

        jobs = bridge.seed_tileset_jobs_for_ui()

        self.assertEqual(len(jobs), 1)
        self.assertEqual(jobs[0].job_type, "tileset")
        self.assertEqual(jobs[0].preview_url, "https://api.pixellab.ai/mcp/tilesets/remote-tile-1/image")
        self.assertEqual(jobs[0].download_url, "https://api.pixellab.ai/mcp/tilesets/remote-tile-1/image")

    def test_live_tileset_submit_uses_bound_tool(self) -> None:
        def create_topdown_tileset(**kwargs):
            self.assertEqual(kwargs["lower_description"], "river")
            self.assertEqual(kwargs["upper_description"], "grass")
            self.assertEqual(kwargs["tile_size"]["width"], 24)
            return {"tileset_id": "tileset-777"}

        bridge = PixelLabBridge({"create_topdown_tileset": create_topdown_tileset})
        job = bridge.submit_tileset("river", "grass", tile_size=24)

        self.assertEqual(job.source, "mcp")
        self.assertEqual(job.remote_id, "tileset-777")

    def test_invalid_prompt_raises(self) -> None:
        bridge = PixelLabBridge()
        with self.assertRaises(ValueError):
            bridge.submit_character("   ")

    def test_bridge_post_uses_long_timeout(self) -> None:
        from projects.shumilek_ui.pixellab_bridge import _bridge_post, REMOTE_MCP_HTTP_TIMEOUT_SECONDS

        captured_timeouts: list[float] = []

        class _FakeResponse:
            def __init__(self) -> None:
                pass
            def read(self) -> bytes:
                return b'{"ok": true, "result": {"character_id": "c1"}}'
            def __enter__(self):
                return self
            def __exit__(self, *args):
                return None

        def fake_urlopen(req, timeout=0):
            captured_timeouts.append(timeout)
            return _FakeResponse()

        with mock.patch("projects.shumilek_ui.pixellab_bridge.urlrequest.urlopen", side_effect=fake_urlopen):
            result = _bridge_post("http://127.0.0.1:9999", "/character/create", {"desc": "elf"})

        self.assertEqual(result, {"character_id": "c1"})
        self.assertEqual(captured_timeouts, [REMOTE_MCP_HTTP_TIMEOUT_SECONDS])

    def test_read_json_response_default_timeout_is_short(self) -> None:
        from projects.shumilek_ui.pixellab_bridge import _read_json_response

        captured_timeouts: list[float] = []

        class _FakeResponse:
            def read(self) -> bytes:
                return b'{"ok": true}'
            def __enter__(self):
                return self
            def __exit__(self, *args):
                return None

        def fake_urlopen(req, timeout=0):
            captured_timeouts.append(timeout)
            return _FakeResponse()

        with mock.patch("projects.shumilek_ui.pixellab_bridge.urlrequest.urlopen", side_effect=fake_urlopen):
            from urllib import request as urlrequest
            req = urlrequest.Request("http://127.0.0.1:9999/health")
            _read_json_response(req)

        self.assertEqual(captured_timeouts, [1.5])

    # ------------------------------------------------------------------
    # Round 34 – expanded coverage
    # ------------------------------------------------------------------

    def test_parse_mcp_messages_survives_malformed_json(self) -> None:
        raw = "data: {broken\n\ndata: " + json.dumps({"jsonrpc": "2.0", "id": 1, "result": {"ok": True}}) + "\n\n"
        messages = _parse_mcp_messages(raw)
        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0]["result"]["ok"], True)

    def test_parse_mcp_messages_malformed_standalone_json(self) -> None:
        self.assertEqual(_parse_mcp_messages("{bad json}"), [])

    def test_parse_mcp_messages_empty_input(self) -> None:
        self.assertEqual(_parse_mcp_messages(""), [])
        self.assertEqual(_parse_mcp_messages("   "), [])

    def test_parse_mcp_messages_trailing_buffer_malformed(self) -> None:
        raw = "data: {not valid json"
        messages = _parse_mcp_messages(raw)
        self.assertEqual(messages, [])

    def test_submit_character_none_raises_value_error(self) -> None:
        bridge = PixelLabBridge()
        with self.assertRaises(ValueError):
            bridge.submit_character(None)  # type: ignore[arg-type]

    def test_submit_tileset_none_raises_value_error(self) -> None:
        bridge = PixelLabBridge()
        with self.assertRaises(ValueError):
            bridge.submit_tileset(None, "upper")  # type: ignore[arg-type]
        with self.assertRaises(ValueError):
            bridge.submit_tileset("lower", None)  # type: ignore[arg-type]

    def test_refresh_jobs_isolates_per_job_failure(self) -> None:
        call_count = 0

        def get_character(**kwargs):
            nonlocal call_count
            call_count += 1
            if kwargs["character_id"] == "fail-id":
                raise RuntimeError("network error")
            return {
                "status": "ready",
                "name": "good char",
                "preview_url": "https://example.invalid/good.png",
            }

        bridge = PixelLabBridge({"get_character": get_character})
        with bridge._jobs_lock:
            bridge.jobs = [
                PixelLabJob(job_id="j1", job_type="character", label="Char", prompt="ok", status="queued", source="mcp", remote_id="good-id"),
                PixelLabJob(job_id="j2", job_type="character", label="Char", prompt="fail", status="queued", source="mcp", remote_id="fail-id"),
            ]

        jobs = bridge.refresh_jobs()
        self.assertEqual(len(jobs), 2)
        good = next(j for j in jobs if j.job_id == "j1")
        failed = next(j for j in jobs if j.job_id == "j2")
        self.assertEqual(good.status, "ready")
        self.assertEqual(failed.status, "queued")  # kept original

    def test_seed_jobs_preserves_concurrent_submissions(self) -> None:
        import threading

        def list_characters(**_kwargs):
            # Simulate slow HTTP: submit a job concurrently during this call
            bridge.submit_character("concurrent wizard")
            return {"items": []}

        bridge = PixelLabBridge({"list_characters": list_characters, "create_character": lambda **kw: {"character_id": "conc-1"}})
        bridge.submit_character("original elf")

        jobs = bridge.seed_jobs_for_ui()
        job_prompts = {j.prompt for j in jobs}
        self.assertIn("original elf", job_prompts)
        self.assertIn("concurrent wizard", job_prompts)

    def test_extract_backtick_value_parses_markdown(self) -> None:
        text = "**Character ID:** `abc-123`\n**Name:** Wizard"
        self.assertEqual(_extract_backtick_value(text, "Character ID"), "abc-123")
        self.assertEqual(_extract_backtick_value(text, "Missing"), "")

    def test_extract_named_value_parses_markdown(self) -> None:
        text = "**Name:** Moss wizard\n**Status:** Processing"
        self.assertEqual(_extract_named_value(text, "Name"), "Moss wizard")
        self.assertEqual(_extract_named_value(text, "Status"), "Processing")
        self.assertEqual(_extract_named_value(text, "Missing"), "")

    def test_extract_markdown_urls(self) -> None:
        text = "[south](https://example.invalid/south.png) and [download](https://example.invalid/file.zip)"
        urls = _extract_markdown_urls(text)
        self.assertEqual(urls, ["https://example.invalid/south.png", "https://example.invalid/file.zip"])
        self.assertEqual(_extract_markdown_urls("no urls here"), [])

    def test_tool_text_content_extracts_text_parts(self) -> None:
        result = {"content": [{"type": "text", "text": "hello"}, {"type": "image", "data": "..."}, {"type": "text", "text": "world"}]}
        self.assertEqual(_tool_text_content(result), "hello\nworld")

    def test_tool_text_content_handles_missing_content(self) -> None:
        self.assertEqual(_tool_text_content({}), "")
        self.assertEqual(_tool_text_content({"content": "not a list"}), "")

    def test_merge_detail_appends_metadata(self) -> None:
        bridge = PixelLabBridge()
        result = {"name": "wizard", "preview_url": "https://example.invalid/p.png", "download_url": "https://example.invalid/d.zip"}
        merged = bridge._merge_detail("size=48", result)
        self.assertIn("size=48", merged)
        self.assertIn("download_url=", merged)
        self.assertIn("preview_url=", merged)
        self.assertIn("name=wizard", merged)

    def test_merge_detail_returns_existing_when_no_metadata(self) -> None:
        bridge = PixelLabBridge()
        self.assertEqual(bridge._merge_detail("size=48", {}), "size=48")
        self.assertEqual(bridge._merge_detail("size=48", "not a dict"), "size=48")

    # ------------------------------------------------------------------
    # Round 35 – parser and extractor coverage
    # ------------------------------------------------------------------

    def test_parse_remote_listing_entries_parses_ready_and_processing(self) -> None:
        text = (
            "📋 Your Characters (2 shown)\n\n"
            "✅ **Moss wizard** `char-001`\n"
            "    - 8 directions • 48×48\n"
            "\n"
            "⏳ **Fire mage** `char-002`\n"
            "    - Creating 4-directions\n"
            "    - Status: processing in background\n"
        )
        entries = _parse_remote_listing_entries(text)
        self.assertEqual(len(entries), 2)
        self.assertEqual(entries[0]["remote_id"], "char-001")
        self.assertEqual(entries[0]["status"], "ready")
        self.assertIn("8 directions", entries[0]["detail"])
        self.assertEqual(entries[1]["remote_id"], "char-002")
        self.assertEqual(entries[1]["status"], "processing in background")

    def test_parse_remote_listing_entries_empty_text(self) -> None:
        self.assertEqual(_parse_remote_listing_entries(""), [])
        self.assertEqual(_parse_remote_listing_entries("no entries here"), [])

    def test_parse_remote_listing_entries_skips_next_hint(self) -> None:
        text = (
            "✅ **Wizard** `w-1`\n"
            "    - 8 directions\n"
            "→ Next: create more characters\n"
        )
        entries = _parse_remote_listing_entries(text)
        self.assertEqual(len(entries), 1)
        self.assertNotIn("Next:", entries[0]["detail"])

    def test_extract_progress_status_detects_processing(self) -> None:
        self.assertEqual(
            _extract_progress_status("Character is still being generated in background", "Character"),
            "processing",
        )
        self.assertEqual(
            _extract_progress_status("**Status:** Processing in background", "Character"),
            "processing",
        )

    def test_extract_progress_status_detects_ready(self) -> None:
        self.assertEqual(
            _extract_progress_status("**Status:** Ready\nRotation Images:\n- [south](https://example.invalid/s.png)", "Character"),
            "ready",
        )
        self.assertEqual(
            _extract_progress_status("**Status:** Completed", "Tileset"),
            "ready",
        )

    def test_extract_progress_status_detects_ready_from_content(self) -> None:
        self.assertEqual(
            _extract_progress_status("Rotation Images:\n- preview available", "Character"),
            "ready",
        )
        self.assertEqual(
            _extract_progress_status("Download:\n- [zip](https://example.invalid/file.zip)", "Tileset"),
            "ready",
        )

    def test_extract_progress_status_unknown_fallback(self) -> None:
        self.assertEqual(_extract_progress_status("nothing useful here", "Character"), "unknown")

    def test_normalize_remote_tool_result_create_character(self) -> None:
        result = {
            "content": [{"type": "text", "text": "**Character ID:** `abc-123`\n**Name:** Moss wizard\nCharacter is still being generated in background"}]
        }
        normalized = _normalize_remote_tool_result("create_character", result)
        self.assertEqual(normalized["character_id"], "abc-123")
        self.assertEqual(normalized["name"], "Moss wizard")
        self.assertEqual(normalized["status"], "processing")

    def test_normalize_remote_tool_result_get_character(self) -> None:
        result = {
            "content": [{"type": "text", "text": (
                "**Character:** Moss wizard\n**ID:** `abc-123`\n**Status:** Ready\n\n"
                "**Rotation Images:**\n- [south](https://example.invalid/rotations/south.png)\n\n"
                "**Download:** [Download as ZIP](https://example.invalid/download/char.zip)"
            )}]
        }
        normalized = _normalize_remote_tool_result("get_character", result)
        self.assertEqual(normalized["character_id"], "abc-123")
        self.assertEqual(normalized["name"], "Moss wizard")
        self.assertEqual(normalized["status"], "ready")
        self.assertEqual(normalized["preview_url"], "https://example.invalid/rotations/south.png")
        self.assertEqual(normalized["download_url"], "https://example.invalid/download/char.zip")

    def test_normalize_remote_tool_result_create_tileset(self) -> None:
        result = {
            "content": [{"type": "text", "text": "**Tileset ID:** `tile-99`\n**Description:** Dark grid\nTileset is still being generated in background"}]
        }
        normalized = _normalize_remote_tool_result("create_topdown_tileset", result)
        self.assertEqual(normalized["tileset_id"], "tile-99")
        self.assertEqual(normalized["tileset_name"], "Dark grid")
        self.assertEqual(normalized["status"], "processing")

    def test_normalize_remote_tool_result_get_tileset(self) -> None:
        result = {
            "content": [{"type": "text", "text": (
                "**Tileset ID:** `tile-99`\n**Tileset:** Dark topology\n**Status:** Ready\n\n"
                "- [Preview](https://example.invalid/tilesets/tile-99/image)\n"
            )}]
        }
        normalized = _normalize_remote_tool_result("get_topdown_tileset", result)
        self.assertEqual(normalized["tileset_id"], "tile-99")
        self.assertEqual(normalized["tileset_name"], "Dark topology")
        self.assertEqual(normalized["status"], "ready")
        self.assertIn("example.invalid", normalized["preview_url"])

    def test_normalize_remote_tool_result_list_characters(self) -> None:
        result = {
            "content": [{"type": "text", "text": "✅ **Wizard** `w-1`\n    - 8 dirs\n"}]
        }
        normalized = _normalize_remote_tool_result("list_characters", result)
        self.assertIsInstance(normalized["items"], list)
        self.assertEqual(len(normalized["items"]), 1)
        self.assertEqual(normalized["items"][0]["remote_id"], "w-1")

    def test_normalize_remote_tool_result_unknown_tool(self) -> None:
        result = {"content": [{"type": "text", "text": "hello"}]}
        self.assertEqual(_normalize_remote_tool_result("unknown_tool", result), result)

    def test_extract_status_dict_paths(self) -> None:
        bridge = PixelLabBridge()
        self.assertEqual(bridge._extract_status({"status": "ready"}), "ready")
        self.assertEqual(bridge._extract_status({"state": "processing"}), "processing")
        self.assertEqual(bridge._extract_status({"job_status": "queued"}), "queued")
        self.assertEqual(bridge._extract_status({"pending_jobs": [1]}), "processing")
        self.assertEqual(bridge._extract_status({"animations": []}), "ready")
        self.assertEqual(bridge._extract_status({}), "unknown")

    def test_extract_status_non_dict(self) -> None:
        bridge = PixelLabBridge()
        self.assertEqual(bridge._extract_status("not a dict"), "unknown")

    def test_extract_remote_id_dict_and_object(self) -> None:
        bridge = PixelLabBridge()
        self.assertEqual(bridge._extract_remote_id({"character_id": "c1"}, "character_id"), "c1")
        self.assertIsNone(bridge._extract_remote_id({}, "character_id"))
        job = PixelLabJob(job_id="j", job_type="c", label="L", prompt="p", status="q", source="m", remote_id="r1")
        self.assertEqual(bridge._extract_remote_id(job, "remote_id"), "r1")

    def test_extract_asset_metadata_non_dict(self) -> None:
        bridge = PixelLabBridge()
        meta = bridge._extract_asset_metadata("not a dict")
        self.assertEqual(meta, {"asset_name": "", "preview_url": "", "download_url": ""})

    def test_extract_asset_metadata_priority_keys(self) -> None:
        bridge = PixelLabBridge()
        meta = bridge._extract_asset_metadata({
            "title": "fallback",
            "name": "primary",
            "thumbnail_url": "https://example.invalid/thumb.png",
            "preview_url": "https://example.invalid/preview.png",
            "asset_url": "https://example.invalid/asset.zip",
            "download_url": "https://example.invalid/download.zip",
        })
        self.assertEqual(meta["asset_name"], "primary")
        self.assertEqual(meta["preview_url"], "https://example.invalid/preview.png")
        self.assertEqual(meta["download_url"], "https://example.invalid/download.zip")

    def test_build_imported_jobs_handles_malformed_input(self) -> None:
        bridge = PixelLabBridge()
        self.assertEqual(bridge._build_imported_jobs("not a dict", "character", "Char"), [])
        self.assertEqual(bridge._build_imported_jobs({"items": "not a list"}, "character", "Char"), [])
        self.assertEqual(bridge._build_imported_jobs({"items": [{"no_id": True}]}, "character", "Char"), [])

    def test_build_imported_jobs_creates_valid_jobs(self) -> None:
        bridge = PixelLabBridge()
        result = {"items": [
            {"remote_id": "r1", "label": "Wizard", "status": "ready", "detail": "8 dirs"},
            {"remote_id": "r2", "prompt": "Mage", "status": "processing"},
        ]}
        jobs = bridge._build_imported_jobs(result, "character", "Character queued")
        self.assertEqual(len(jobs), 2)
        self.assertEqual(jobs[0].remote_id, "r1")
        self.assertEqual(jobs[0].prompt, "Wizard")
        self.assertEqual(jobs[0].status, "ready")
        self.assertEqual(jobs[1].remote_id, "r2")
        self.assertEqual(jobs[1].prompt, "Mage")

    def test_build_imported_jobs_tileset_ready_gets_preview_url(self) -> None:
        bridge = PixelLabBridge()
        result = {"items": [{"remote_id": "t1", "label": "Grid", "status": "ready"}]}
        jobs = bridge._build_imported_jobs(result, "tileset", "Tileset queued")
        self.assertEqual(len(jobs), 1)
        self.assertIn("t1", jobs[0].preview_url)
        self.assertIn("t1", jobs[0].download_url)


if __name__ == "__main__":
    unittest.main()