import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
from pathlib import Path
import tempfile
import threading
import unittest
from unittest import mock

from projects.shumilek_ui.pixellab_bridge import BRIDGE_MANIFEST_ENV, PixelLabBridge, PixelLabJob, discover_remote_tool_bindings


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


if __name__ == "__main__":
    unittest.main()