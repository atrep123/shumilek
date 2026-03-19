from __future__ import annotations

from pathlib import Path
import tempfile
import unittest
from unittest import mock

from projects.shumilek_ui.asset_cache import (
    browser_url_for_path,
    cached_asset_path,
    describe_visual_bootstrap_state_issue,
    ensure_asset_cached,
    export_cached_asset,
    load_visual_bootstrap_state,
    save_visual_bootstrap_state,
    suggested_asset_name,
)


class _FakeHeaders:
    def __init__(self, content_type: str) -> None:
        self._content_type = content_type

    def get_content_type(self) -> str:
        return self._content_type


class _FakeResponse:
    def __init__(self, payload: bytes, content_type: str) -> None:
        self._payload = payload
        self.headers = _FakeHeaders(content_type)

    def __enter__(self) -> _FakeResponse:
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None

    def read(self) -> bytes:
        return self._payload


class AssetCacheTests(unittest.TestCase):
    def test_cached_asset_path_uses_url_suffix(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = cached_asset_path("https://example.invalid/sheet.png", cache_dir=Path(temp_dir))
            self.assertEqual(path.suffix, ".png")

    def test_cached_asset_path_falls_back_to_content_type_suffix(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = cached_asset_path(
                "https://example.invalid/download",
                cache_dir=Path(temp_dir),
                content_type="image/gif",
            )
            self.assertEqual(path.suffix, ".gif")

    def test_ensure_asset_cached_writes_file_once(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            with mock.patch(
                "projects.shumilek_ui.asset_cache.urlrequest.urlopen",
                return_value=_FakeResponse(b"preview-bytes", "image/png"),
            ) as mocked_open:
                first_path, first_created = ensure_asset_cached("https://example.invalid/preview.png", cache_dir=Path(temp_dir))
                second_path, second_created = ensure_asset_cached("https://example.invalid/preview.png", cache_dir=Path(temp_dir))
                self.assertTrue(first_path.exists())
                self.assertEqual(first_path.read_bytes(), b"preview-bytes")
                self.assertEqual(first_path, second_path)
                self.assertTrue(first_created)
                self.assertFalse(second_created)
                self.assertEqual(mocked_open.call_count, 1)
                request = mocked_open.call_args.args[0]
                self.assertEqual(request.full_url, "https://example.invalid/preview.png")
                self.assertIn("Mozilla/5.0", request.get_header("User-agent"))

    def test_browser_url_for_path_returns_file_uri(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "asset.png"
            path.write_bytes(b"demo")
            self.assertTrue(browser_url_for_path(path).startswith("file://"))

    def test_suggested_asset_name_uses_url_name(self) -> None:
        self.assertEqual(suggested_asset_name("https://example.invalid/files/hero-sheet.png"), "hero-sheet.png")
        self.assertEqual(suggested_asset_name("https://example.invalid/download", fallback_name="fallback.bin"), "download")

    def test_export_cached_asset_copies_bytes(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "source.png"
            source.write_bytes(b"cached-preview")
            destination = Path(temp_dir) / "exports" / "copy.png"
            exported = export_cached_asset(source, destination)
            self.assertEqual(exported, destination)
            self.assertEqual(destination.read_bytes(), b"cached-preview")

    def test_ensure_asset_cached_can_force_refresh(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            responses = [
                _FakeResponse(b"first-version", "image/png"),
                _FakeResponse(b"second-version", "image/png"),
            ]
            with mock.patch(
                "projects.shumilek_ui.asset_cache.urlrequest.urlopen",
                side_effect=responses,
            ) as mocked_open:
                first_path, first_created = ensure_asset_cached(
                    "https://example.invalid/refresh.png",
                    cache_dir=Path(temp_dir),
                )
                second_path, second_created = ensure_asset_cached(
                    "https://example.invalid/refresh.png",
                    cache_dir=Path(temp_dir),
                    force_refresh=True,
                )

            self.assertEqual(first_path, second_path)
            self.assertTrue(first_created)
            self.assertTrue(second_created)
            self.assertEqual(second_path.read_bytes(), b"second-version")
            self.assertEqual(mocked_open.call_count, 2)

    def test_visual_bootstrap_state_round_trips_existing_cached_file(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            cached_path = Path(temp_dir) / "world.png"
            cached_path.write_bytes(b"png-bytes")

            save_visual_bootstrap_state(
                cached_path,
                preview_url="https://example.invalid/world.png",
                download_url="https://example.invalid/world-download.png",
                job_type="tileset",
                title="World asset",
                subtitle="Server render feed",
                cache_dir=Path(temp_dir),
            )

            payload = load_visual_bootstrap_state(cache_dir=Path(temp_dir))

            self.assertEqual(
                payload,
                {
                    "cached_path": str(cached_path),
                    "preview_url": "https://example.invalid/world.png",
                    "download_url": "https://example.invalid/world-download.png",
                    "job_type": "tileset",
                    "title": "World asset",
                    "subtitle": "Server render feed",
                },
            )

    def test_visual_bootstrap_state_rejects_stale_payload(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            cached_path = Path(temp_dir) / "world.png"
            cached_path.write_bytes(b"png-bytes")

            with mock.patch("projects.shumilek_ui.asset_cache.time.time", return_value=1000.0):
                save_visual_bootstrap_state(
                    cached_path,
                    preview_url="https://example.invalid/world.png",
                    job_type="tileset",
                    title="World asset",
                    subtitle="Server render feed",
                    cache_dir=Path(temp_dir),
                )

            with mock.patch("projects.shumilek_ui.asset_cache.time.time", return_value=1401.0):
                payload = load_visual_bootstrap_state(cache_dir=Path(temp_dir))
                reason = describe_visual_bootstrap_state_issue(cache_dir=Path(temp_dir))

            self.assertIsNone(payload)
            self.assertEqual(reason, "state is stale")

    def test_visual_bootstrap_state_rejects_legacy_payload_without_timestamp(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            cache_dir = Path(temp_dir)
            cached_path = cache_dir / "world.png"
            cached_path.write_bytes(b"png-bytes")
            (cache_dir / "last_visual.json").write_text(
                '{"cached_path": "' + str(cached_path).replace('\\', '\\\\') + '", "preview_url": "https://example.invalid/world.png", "job_type": "tileset", "title": "World asset", "subtitle": "Server render feed"}',
                encoding="utf-8",
            )

            payload = load_visual_bootstrap_state(cache_dir=cache_dir)
            reason = describe_visual_bootstrap_state_issue(cache_dir=cache_dir)

            self.assertIsNone(payload)
            self.assertEqual(reason, "state is missing saved_at")

    def test_visual_bootstrap_state_accepts_legacy_payload_without_download_url(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            cache_dir = Path(temp_dir)
            cached_path = cache_dir / "world.png"
            cached_path.write_bytes(b"png-bytes")
            (cache_dir / "last_visual.json").write_text(
                '{'
                + '"cached_path": "' + str(cached_path).replace('\\', '\\\\') + '", '
                + '"preview_url": "https://example.invalid/world.png", '
                + '"job_type": "tileset", '
                + '"title": "World asset", '
                + '"subtitle": "Server render feed", '
                + '"saved_at": 1000.0'
                + '}',
                encoding="utf-8",
            )

            with mock.patch("projects.shumilek_ui.asset_cache.time.time", return_value=1001.0):
                payload = load_visual_bootstrap_state(cache_dir=cache_dir)
                reason = describe_visual_bootstrap_state_issue(cache_dir=cache_dir)

            self.assertEqual(
                payload,
                {
                    "cached_path": str(cached_path),
                    "preview_url": "https://example.invalid/world.png",
                    "download_url": "",
                    "job_type": "tileset",
                    "title": "World asset",
                    "subtitle": "Server render feed",
                },
            )
            self.assertIsNone(reason)


if __name__ == "__main__":
    unittest.main()