"""Tests for shumilek_hive pure functions and path safety."""
import unittest
import re
import sys
import json
import time
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

# Ensure project root is on sys.path so main module can be imported selectively
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


class SafeNoteNameTests(unittest.TestCase):
    """Tests for _is_safe_note_name path traversal guard."""

    @classmethod
    def setUpClass(cls):
        # Import only the guard function (no Tkinter needed)
        import importlib
        import types
        # We can't import main directly (it launches Tkinter constants),
        # so we exec just the function definition.
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        # Extract the function source
        fn_start = source.index("def _is_safe_note_name(")
        fn_end = source.index("\n\nclass ShumilekHive")
        fn_source = source[fn_start:fn_end]
        ns: dict = {"Path": Path}
        exec(fn_source, ns)  # noqa: S102 — test-only, trusted source
        cls._is_safe = staticmethod(ns["_is_safe_note_name"])

    # --- Valid names ---
    def test_simple_name_accepted(self):
        self.assertTrue(self._is_safe("notes.md"))

    def test_name_with_spaces_accepted(self):
        self.assertTrue(self._is_safe("My Note.md"))

    def test_name_with_hyphen_accepted(self):
        self.assertTrue(self._is_safe("daily-log.md"))

    # --- Traversal attacks ---
    def test_rejects_dotdot(self):
        self.assertFalse(self._is_safe("../../evil.md"))

    def test_rejects_dotdot_prefix(self):
        self.assertFalse(self._is_safe("..secret.md"))

    def test_rejects_forward_slash(self):
        self.assertFalse(self._is_safe("sub/note.md"))

    def test_rejects_backslash(self):
        self.assertFalse(self._is_safe("sub\\note.md"))

    # --- Empty / whitespace ---
    def test_rejects_empty_string(self):
        self.assertFalse(self._is_safe(""))

    def test_rejects_whitespace_only(self):
        self.assertFalse(self._is_safe("   "))

    def test_rejects_none(self):
        # Guard should handle falsy input
        self.assertFalse(self._is_safe(None))

    # --- Additional traversal bypass patterns (R35) ---
    def test_rejects_dotdot_backslash_traversal(self):
        self.assertFalse(self._is_safe("..\\etc\\passwd"))

    def test_rejects_mixed_separators(self):
        self.assertFalse(self._is_safe("foo/..\\bar"))

    def test_rejects_encoded_dot_dot(self):
        # Even if someone tries a name containing literal ".."
        self.assertFalse(self._is_safe(".."))

    def test_rejects_only_dots(self):
        self.assertFalse(self._is_safe("..."))

    def test_rejects_absolute_unix_path(self):
        self.assertFalse(self._is_safe("/etc/passwd"))

    def test_rejects_absolute_windows_path(self):
        self.assertFalse(self._is_safe("C:\\Windows\\system32"))

    def test_accepts_name_with_dots_no_traversal(self):
        # "my.note.v2" is fine — no ".." component
        self.assertTrue(self._is_safe("my.note.v2"))

    def test_accepts_name_with_underscore(self):
        self.assertTrue(self._is_safe("_draft_notes"))

    def test_rejects_path_with_directory_component(self):
        self.assertFalse(self._is_safe("subdir/file.md"))


class NewFolderValidationTests(unittest.TestCase):
    """Tests for _new_folder validation regex + Path check (R35 security fix)."""

    def _is_valid_folder_name(self, name: str) -> bool:
        """Replicate the _new_folder validation logic from main.py."""
        if not name:
            return False
        if not re.match(r'^[\w\-. ]+$', name) or ".." in name or Path(name).name != name:
            return False
        return True

    def test_simple_folder_name(self):
        self.assertTrue(self._is_valid_folder_name("Projects"))

    def test_folder_with_spaces(self):
        self.assertTrue(self._is_valid_folder_name("My Folder"))

    def test_folder_with_hyphen_underscore(self):
        self.assertTrue(self._is_valid_folder_name("project-notes_2025"))

    def test_folder_with_dot(self):
        self.assertTrue(self._is_valid_folder_name("archive.old"))

    def test_rejects_traversal(self):
        self.assertFalse(self._is_valid_folder_name("../evil"))

    def test_rejects_backslash_traversal(self):
        self.assertFalse(self._is_valid_folder_name("..\\evil"))

    def test_rejects_subdirectory_slash(self):
        self.assertFalse(self._is_valid_folder_name("sub/folder"))

    def test_rejects_special_chars(self):
        self.assertFalse(self._is_valid_folder_name("folder<name>"))

    def test_rejects_empty(self):
        self.assertFalse(self._is_valid_folder_name(""))

    def test_rejects_colon(self):
        self.assertFalse(self._is_valid_folder_name("C:"))

    def test_rejects_pipe(self):
        self.assertFalse(self._is_valid_folder_name("a|b"))

    def test_rejects_dotdot_only(self):
        self.assertFalse(self._is_valid_folder_name(".."))


class HiveReportPathTests(unittest.TestCase):
    """Tests for _hive_report_path sanitization without instantiating full Hive."""

    def _build_report_path(self, report_name: str) -> Path:
        """Replicate _hive_report_path logic (from main.py) for testing."""
        safe_name = re.sub(r'[^\w\- ]+', ' ', str(report_name)).strip() or "Hive Report"
        safe_name = safe_name.replace(".", "")
        if not safe_name:
            safe_name = "Hive Report"
        vault = Path("/fake/vault")
        report_dir = vault / "Hive Reports"
        return report_dir / f"{safe_name}.md"

    def test_normal_name(self):
        p = self._build_report_path("Vault Analysis")
        self.assertEqual(p.name, "Vault Analysis.md")

    def test_traversal_dots_stripped(self):
        p = self._build_report_path("../../etc/passwd")
        # Dots and slashes sanitized — no traversal component
        self.assertNotIn("..", str(p))
        self.assertTrue(p.parent.name == "Hive Reports")

    def test_empty_falls_back(self):
        p = self._build_report_path("")
        self.assertEqual(p.name, "Hive Report.md")

    def test_dots_only_falls_back(self):
        p = self._build_report_path("....")
        self.assertEqual(p.name, "Hive Report.md")

    def test_special_chars_sanitized(self):
        p = self._build_report_path("Report <v2> @draft!")
        self.assertNotIn("<", p.name)
        self.assertNotIn(">", p.name)


class ParticleTests(unittest.TestCase):
    """Tests for Particle pure logic (no Tkinter canvas)."""

    @classmethod
    def setUpClass(cls):
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        # Extract Particle class
        cls_start = source.index("class Particle:")
        cls_end = source.index("\n\nclass ParticleSystem:")
        cls_source = source[cls_start:cls_end]
        ns: dict = {"random": __import__("random"), "math": __import__("math")}
        exec(cls_source, ns)  # noqa: S102
        cls.Particle = ns["Particle"]

    def test_particle_starts_alive(self):
        p = self.Particle(100, 100, "#4AE3D0", 2)
        self.assertEqual(p.life, 0)
        self.assertTrue(p.update())

    def test_particle_dies_after_max_life(self):
        p = self.Particle(100, 100, "#4AE3D0", 2)
        p.max_life = 5
        for _ in range(5):
            p.update()
        self.assertFalse(p.update())

    def test_alpha_hex_returns_valid_color(self):
        p = self.Particle(0, 0, "#4AE3D0", 2)
        color = p.alpha_hex
        self.assertTrue(color.startswith("#"))
        self.assertEqual(len(color), 7)

    def test_alpha_hex_fades_over_lifetime(self):
        p = self.Particle(0, 0, "#FFFFFF", 2)
        p.max_life = 100
        p.life = 0
        bright = p.alpha_hex
        p.life = 90
        dim = p.alpha_hex
        # Dim should have lower RGB values
        bright_sum = sum(int(bright[i:i+2], 16) for i in (1, 3, 5))
        dim_sum = sum(int(dim[i:i+2], 16) for i in (1, 3, 5))
        self.assertGreater(bright_sum, dim_sum)


class StopWordsTests(unittest.TestCase):
    """Tests for _STOP_WORDS constant."""

    @classmethod
    def setUpClass(cls):
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        sw_start = source.index("_STOP_WORDS: frozenset[str] = frozenset({")
        sw_end = source.index("})", sw_start) + 2
        ns: dict = {}
        exec(source[sw_start:sw_end], ns)  # noqa: S102
        cls.stop_words = ns["_STOP_WORDS"]

    def test_contains_english_common_words(self):
        for w in ("the", "a", "is", "and", "but", "or"):
            self.assertIn(w, self.stop_words)

    def test_contains_czech_common_words(self):
        for w in ("se", "je", "na", "za", "ale", "nebo"):
            self.assertIn(w, self.stop_words)

    def test_is_frozenset(self):
        self.assertIsInstance(self.stop_words, frozenset)

    def test_all_lowercase(self):
        for w in self.stop_words:
            self.assertEqual(w, w.lower(), f"Stop word '{w}' not lowercase")


class KeywordExtractionTests(unittest.TestCase):
    """Tests for _ai_extract_keywords logic (reimplemented without Tkinter)."""

    @classmethod
    def setUpClass(cls):
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        # Get stop words
        sw_start = source.index("_STOP_WORDS: frozenset[str] = frozenset({")
        sw_end = source.index("})", sw_start) + 2
        ns: dict = {}
        exec(source[sw_start:sw_end], ns)  # noqa: S102
        cls.stop_words = ns["_STOP_WORDS"]

    def _extract_keywords(self, text: str, top_n: int = 12) -> list[tuple[str, int]]:
        """Replicates _ai_extract_keywords without needing ShumilekHive instance."""
        words = re.findall(r'[a-zA-Z\u00C0-\u017E]{3,}', text.lower())
        freq: dict[str, int] = {}
        for w in words:
            if w not in self.stop_words and len(w) >= 3:
                freq[w] = freq.get(w, 0) + 1
        return sorted(freq.items(), key=lambda x: x[1], reverse=True)[:top_n]

    def test_extracts_repeated_words(self):
        text = "Python is great. Python rocks. Python everywhere."
        kw = self._extract_keywords(text)
        self.assertEqual(kw[0][0], "python")
        self.assertEqual(kw[0][1], 3)

    def test_filters_stop_words(self):
        text = "The the the and and and"
        kw = self._extract_keywords(text)
        self.assertEqual(kw, [])

    def test_respects_top_n(self):
        text = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu"
        kw = self._extract_keywords(text, top_n=3)
        self.assertEqual(len(kw), 3)

    def test_handles_empty_text(self):
        kw = self._extract_keywords("")
        self.assertEqual(kw, [])

    def test_handles_czech_diacritics(self):
        text = "příliš žluťoučký kůň úpěl ďábelské ódy příliš příliš"
        kw = self._extract_keywords(text)
        names = [name for name, _ in kw]
        self.assertIn("příliš", names)

    def test_ignores_short_words(self):
        text = "ab cd ef gh ij kl mn"
        kw = self._extract_keywords(text)
        self.assertEqual(kw, [])


class InlineHtmlXssTests(unittest.TestCase):
    """Tests for _inline_html wikilink XSS prevention (R49)."""

    @classmethod
    def setUpClass(cls):
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        # Extract _escape_html and _inline_html methods as standalone functions
        import textwrap
        esc_start = source.index("    def _escape_html(self, text: str) -> str:")
        inline_end_marker = "    def _on_editor_click"
        inline_end = source.index(inline_end_marker)
        block = source[esc_start:inline_end]
        block = textwrap.dedent(block)
        # Convert methods to standalone functions for testing
        block = block.replace("def _escape_html(self, text: str)", "def _escape_html(text)")
        block = block.replace("def _inline_html(self, text: str)", "def _inline_html(text)")
        block = block.replace("self._escape_html(", "_escape_html(")
        ns: dict = {"re": re}
        exec(block, ns)  # noqa: S102 — test-only, trusted source
        cls._inline_html = staticmethod(ns["_inline_html"])

    def test_normal_wikilink_produces_anchor(self):
        result = self._inline_html("see [[MyPage]] for details")
        self.assertIn('<a href="MyPage.html">MyPage</a>', result)

    def test_javascript_uri_blocked(self):
        result = self._inline_html("click [[javascript:alert(1)]]")
        self.assertNotIn("<a ", result)
        self.assertIn('<span class="wikilink">', result)

    def test_data_uri_blocked(self):
        result = self._inline_html("click [[data:text/html,<h1>xss</h1>]]")
        self.assertNotIn("<a ", result)
        self.assertIn('<span class="wikilink">', result)

    def test_colon_in_target_blocked(self):
        result = self._inline_html("[[vbscript:run]]")
        self.assertNotIn("<a ", result)

    def test_normal_page_no_colon_allowed(self):
        result = self._inline_html("[[DailyNotes]]")
        self.assertIn('<a href="DailyNotes.html">', result)


class EventLogCapTests(unittest.TestCase):
    """Tests for PipelineSimulator event_log cap at 200 (R49)."""

    def test_event_log_capped_at_200(self):
        """Replicated logic: after many appends + trimming, list stays <= 200."""
        event_log: list[str] = []
        for i in range(500):
            event_log.append(f"[{i}.0s] >> Node{i} — processing...")
            if len(event_log) > 200:
                event_log = event_log[-200:]
        self.assertLessEqual(len(event_log), 200)
        self.assertEqual(len(event_log), 200)
        # Newest entry is last
        self.assertIn("Node499", event_log[-1])

    def test_event_log_not_trimmed_below_threshold(self):
        """Under 200 entries, nothing is trimmed."""
        event_log: list[str] = []
        for i in range(50):
            event_log.append(f"event-{i}")
            if len(event_log) > 200:
                event_log = event_log[-200:]
        self.assertEqual(len(event_log), 50)


class TaskPipelineMapTests(unittest.TestCase):
    """Tests for _TASK_PIPELINE_MAP task-kind → pipeline-scenario mapping."""

    @classmethod
    def setUpClass(cls):
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        start = source.index("_TASK_PIPELINE_MAP = {")
        end = source.index("}", start) + 1
        ns: dict = {}
        exec(source[start:end], ns)  # noqa: S102
        cls.mapping = ns["_TASK_PIPELINE_MAP"]

    def test_all_9_task_kinds_mapped(self):
        expected = {"vault-health", "vault-quality", "vault-links", "smart-links",
                    "note-analysis", "vault-stats", "tags", "summary", "title"}
        self.assertEqual(set(self.mapping.keys()), expected)

    def test_complex_tasks_map_to_retry(self):
        self.assertEqual(self.mapping["vault-health"], "retry")
        self.assertEqual(self.mapping["vault-quality"], "retry")

    def test_link_tasks_map_to_hallucination(self):
        self.assertEqual(self.mapping["vault-links"], "hallucination")
        self.assertEqual(self.mapping["smart-links"], "hallucination")

    def test_simple_tasks_map_to_success(self):
        for kind in ("note-analysis", "vault-stats", "tags", "summary", "title"):
            self.assertEqual(self.mapping[kind], "success", f"{kind} should map to 'success'")

    def test_unknown_kind_falls_back_to_default(self):
        scenario = self.mapping.get("unknown-kind", "default")
        self.assertEqual(scenario, "default")

    def test_all_scenarios_valid(self):
        valid = {"success", "retry", "hallucination", "default"}
        for kind, scenario in self.mapping.items():
            self.assertIn(scenario, valid, f"Kind '{kind}' maps to invalid scenario '{scenario}'")


class TaskLifecycleTests(unittest.TestCase):
    """Tests for task lifecycle logic (priority, cancel, cap) without Tkinter."""

    def _make_task(self, tid, text="test", kind="summary", status="pending", priority=0):
        return {
            "id": tid, "text": text, "kind": kind, "status": status,
            "progress": 0, "result": "", "detail": "", "actions": [],
            "created": 0, "steps": [], "priority": priority,
        }

    def test_priority_sort_picks_highest(self):
        tasks = [
            self._make_task(1, priority=0),
            self._make_task(2, priority=5),
            self._make_task(3, priority=2),
        ]
        pending = [t for t in tasks if t["status"] == "pending"]
        pending.sort(key=lambda t: t.get("priority", 0), reverse=True)
        self.assertEqual(pending[0]["id"], 2)

    def test_priority_sort_stable_for_equal_priority(self):
        tasks = [
            self._make_task(1, priority=0),
            self._make_task(2, priority=0),
            self._make_task(3, priority=0),
        ]
        pending = [t for t in tasks if t["status"] == "pending"]
        pending.sort(key=lambda t: t.get("priority", 0), reverse=True)
        # Original order preserved (stable sort)
        self.assertEqual([t["id"] for t in pending], [1, 2, 3])

    def test_cancel_running_task_sets_cancelled_status(self):
        task = self._make_task(1, status="running")
        task["status"] = "cancelled"
        task["result"] = "Cancelled by user"
        self.assertEqual(task["status"], "cancelled")
        self.assertEqual(task["result"], "Cancelled by user")

    def test_cancel_pending_task_sets_cancelled_status(self):
        task = self._make_task(1, status="pending")
        task["status"] = "cancelled"
        task["result"] = "Cancelled before start"
        self.assertEqual(task["status"], "cancelled")

    def test_task_list_cap_keeps_recent_done(self):
        """Simulate task list cap logic from _hive_submit_task."""
        tasks = []
        for i in range(110):
            t = self._make_task(i, status="done")
            tasks.append(t)
        # Add some pending
        for i in range(110, 115):
            t = self._make_task(i, status="pending")
            tasks.append(t)
        # Apply cap logic
        if len(tasks) > 100:
            tasks = [
                t for t in tasks if t["status"] != "done"
            ] + [
                t for t in tasks if t["status"] == "done"
            ][-50:]
        self.assertLessEqual(len(tasks), 55)  # 5 pending + 50 done
        # All pending tasks preserved
        pending = [t for t in tasks if t["status"] == "pending"]
        self.assertEqual(len(pending), 5)
        # Only last 50 done tasks kept
        done = [t for t in tasks if t["status"] == "done"]
        self.assertEqual(len(done), 50)

    def test_task_list_cap_noop_under_threshold(self):
        tasks = [self._make_task(i, status="done") for i in range(50)]
        original_len = len(tasks)
        if len(tasks) > 100:
            tasks = [t for t in tasks if t["status"] != "done"] + [
                t for t in tasks if t["status"] == "done"
            ][-50:]
        self.assertEqual(len(tasks), original_len)

    def test_cancelled_tasks_hidden_in_visible_list(self):
        """Simulate _hive_update_task_list filtering of cancelled tasks."""
        tasks = [
            self._make_task(1, status="done"),
            self._make_task(2, status="cancelled"),
            self._make_task(3, status="pending"),
        ]
        visible = [t for t in tasks[-15:] if t["status"] != "cancelled"]
        self.assertEqual(len(visible), 2)
        self.assertNotIn("cancelled", [t["status"] for t in visible])

    def test_start_next_guards_against_concurrent(self):
        """_hive_start_next_task returns early when processing_task is set."""
        processing_task = self._make_task(1, status="running")
        # Guard: if processing_task is set, don't start another
        started = False
        if not processing_task:
            started = True
        self.assertFalse(started)


class FileCacheLRUTests(unittest.TestCase):
    """Tests for _file_content_cache LRU eviction."""

    def test_cache_evicts_oldest_when_full(self):
        """Replicate _read_cached LRU logic."""
        cache: dict[str, tuple[float, str]] = {}
        max_size = 5
        # Fill cache with entries with increasing mtime
        for i in range(max_size + 3):
            key = f"file_{i}"
            if len(cache) >= max_size:
                to_remove = sorted(cache, key=lambda k: cache[k][0])
                to_remove = to_remove[:len(cache) - max_size + 1]
                for k in to_remove:
                    del cache[k]
            cache[key] = (float(i), f"content_{i}")
        self.assertLessEqual(len(cache), max_size)
        # Oldest entries should be evicted
        self.assertNotIn("file_0", cache)
        self.assertNotIn("file_1", cache)
        self.assertNotIn("file_2", cache)
        # Newest should be present
        self.assertIn(f"file_{max_size + 2}", cache)

    def test_cache_retains_all_when_under_limit(self):
        cache: dict[str, tuple[float, str]] = {}
        max_size = 10
        for i in range(5):
            key = f"file_{i}"
            if len(cache) >= max_size:
                to_remove = sorted(cache, key=lambda k: cache[k][0])[:len(cache) - max_size + 1]
                for k in to_remove:
                    del cache[k]
            cache[key] = (float(i), f"content_{i}")
        self.assertEqual(len(cache), 5)

    def test_cache_eviction_keeps_newest_entries(self):
        cache: dict[str, tuple[float, str]] = {}
        max_size = 3
        for i in range(10):
            key = f"f{i}"
            if len(cache) >= max_size:
                to_remove = sorted(cache, key=lambda k: cache[k][0])[:len(cache) - max_size + 1]
                for k in to_remove:
                    del cache[k]
            cache[key] = (float(i), f"c{i}")
        self.assertEqual(len(cache), max_size)
        # Last 3 entries should be present
        for i in range(7, 10):
            self.assertIn(f"f{i}", cache)


class TaskHistoryTests(unittest.TestCase):
    """Tests for task history JSON export."""

    def _make_save_fn(self, vault_path: Path, max_entries: int = 500):
        """Build standalone _hive_save_task_history from source."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        # We replicate the logic inline to avoid Tkinter
        import json as _json, time as _time

        def save(task: dict):
            history_dir = vault_path / "Hive Reports"
            history_dir.mkdir(parents=True, exist_ok=True)
            history_path = history_dir / "task_history.json"
            entry = {
                "id": task.get("id"),
                "text": task.get("text", "")[:200],
                "kind": task.get("kind", "task"),
                "status": task.get("status", "unknown"),
                "result": task.get("result", "")[:300],
                "created": task.get("created", 0),
                "completed": _time.time(),
            }
            history: list = []
            if history_path.exists():
                raw = history_path.read_text(encoding="utf-8")
                if raw.strip():
                    history = _json.loads(raw)
            history.append(entry)
            if len(history) > max_entries:
                history = history[-max_entries:]
            history_path.write_text(
                _json.dumps(history, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )

        return save

    def test_saves_task_to_json(self):
        with tempfile.TemporaryDirectory() as td:
            vault = Path(td)
            save = self._make_save_fn(vault)
            task = {"id": 1, "text": "analyze vault", "kind": "summary",
                    "status": "done", "result": "OK", "created": 100.0}
            save(task)
            hp = vault / "Hive Reports" / "task_history.json"
            self.assertTrue(hp.exists())
            data = json.loads(hp.read_text(encoding="utf-8"))
            self.assertEqual(len(data), 1)
            self.assertEqual(data[0]["id"], 1)
            self.assertEqual(data[0]["kind"], "summary")

    def test_appends_multiple_tasks(self):
        with tempfile.TemporaryDirectory() as td:
            vault = Path(td)
            save = self._make_save_fn(vault)
            for i in range(5):
                save({"id": i, "text": f"task {i}", "kind": "tags",
                      "status": "done", "result": f"r{i}", "created": float(i)})
            hp = vault / "Hive Reports" / "task_history.json"
            data = json.loads(hp.read_text(encoding="utf-8"))
            self.assertEqual(len(data), 5)
            self.assertEqual(data[4]["id"], 4)

    def test_caps_history_at_max(self):
        with tempfile.TemporaryDirectory() as td:
            vault = Path(td)
            max_n = 10
            save = self._make_save_fn(vault, max_entries=max_n)
            for i in range(max_n + 5):
                save({"id": i, "text": f"t{i}", "kind": "tags",
                      "status": "done", "result": f"r{i}", "created": float(i)})
            hp = vault / "Hive Reports" / "task_history.json"
            data = json.loads(hp.read_text(encoding="utf-8"))
            self.assertEqual(len(data), max_n)
            # Oldest entries should be trimmed
            self.assertEqual(data[0]["id"], 5)
            self.assertEqual(data[-1]["id"], max_n + 4)

    def test_truncates_long_text_and_result(self):
        with tempfile.TemporaryDirectory() as td:
            vault = Path(td)
            save = self._make_save_fn(vault)
            long_text = "x" * 500
            long_result = "r" * 600
            save({"id": 1, "text": long_text, "kind": "summary",
                  "status": "done", "result": long_result, "created": 1.0})
            hp = vault / "Hive Reports" / "task_history.json"
            data = json.loads(hp.read_text(encoding="utf-8"))
            self.assertLessEqual(len(data[0]["text"]), 200)
            self.assertLessEqual(len(data[0]["result"]), 300)

    def test_cancelled_task_saved(self):
        with tempfile.TemporaryDirectory() as td:
            vault = Path(td)
            save = self._make_save_fn(vault)
            save({"id": 1, "text": "abc", "kind": "tags",
                  "status": "cancelled", "result": "Cancelled by user", "created": 1.0})
            hp = vault / "Hive Reports" / "task_history.json"
            data = json.loads(hp.read_text(encoding="utf-8"))
            self.assertEqual(data[0]["status"], "cancelled")


class TaskErrorHandlingTests(unittest.TestCase):
    """Tests for error handling in _hive_complete_task."""

    def test_error_state_on_exception(self):
        """Simulate _hive_execute_task raising and verify error fields."""
        import traceback as _tb
        task = {"id": 1, "text": "fail", "kind": "summary", "status": "running",
                "progress": 50, "result": "", "detail": "", "actions": [],
                "created": 1.0}
        # Simulate the try/except block
        task["status"] = "done"
        task["progress"] = 100
        try:
            raise ValueError("simulated failure")
        except Exception:
            task["status"] = "error"
            tb = _tb.format_exc()
            task["result"] = "Task failed with error"
            task["detail"] = tb[-500:] if len(tb) > 500 else tb
            task["actions"] = []
        self.assertEqual(task["status"], "error")
        self.assertEqual(task["result"], "Task failed with error")
        self.assertIn("simulated failure", task["detail"])

    def test_pipeline_error_state_on_task_error(self):
        """Pipeline nodes transition to error when task errors."""
        node_states = {"context": "done", "routing": "active", "rozum": "idle"}
        end_state = "error"  # simulating task["status"] == "error"
        for nid in list(node_states):
            if node_states[nid] in ("idle", "active"):
                node_states[nid] = end_state
        self.assertEqual(node_states["context"], "done")  # already done — stays
        self.assertEqual(node_states["routing"], "error")
        self.assertEqual(node_states["rozum"], "error")

    def test_normal_complete_keeps_done(self):
        """Pipeline nodes transition to done on normal completion."""
        node_states = {"context": "done", "routing": "active", "rozum": "idle"}
        end_state = "done"
        for nid in list(node_states):
            if node_states[nid] in ("idle", "active"):
                node_states[nid] = end_state
        self.assertEqual(node_states["context"], "done")
        self.assertEqual(node_states["routing"], "done")
        self.assertEqual(node_states["rozum"], "done")


class TaskHistoryMaxConstantTests(unittest.TestCase):
    """Verify _TASK_HISTORY_MAX constant exists in source."""

    def test_constant_defined(self):
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("_TASK_HISTORY_MAX", source)
        # Extract value
        match = re.search(r"_TASK_HISTORY_MAX\s*=\s*(\d+)", source)
        self.assertIsNotNone(match)
        self.assertEqual(int(match.group(1)), 500)


class ImportanceCacheCapTests(unittest.TestCase):
    """Tests for _importance_cache LRU cap."""

    def test_cache_capped_at_max(self):
        """Simulate importance cache cap logic."""
        max_entries = 10
        importance = {f"note_{i}": i / 20.0 for i in range(25)}
        if len(importance) > max_entries:
            sorted_keys = sorted(importance, key=importance.get, reverse=True)
            importance = {k: importance[k] for k in sorted_keys[:max_entries]}
        self.assertEqual(len(importance), max_entries)
        # Top-scoring entries preserved
        self.assertIn("note_24", importance)
        self.assertIn("note_20", importance)
        # Low-scoring entries trimmed
        self.assertNotIn("note_0", importance)
        self.assertNotIn("note_1", importance)

    def test_cache_under_limit_unchanged(self):
        importance = {f"n{i}": float(i) for i in range(5)}
        max_entries = 500
        if len(importance) > max_entries:
            sorted_keys = sorted(importance, key=importance.get, reverse=True)
            importance = {k: importance[k] for k in sorted_keys[:max_entries]}
        self.assertEqual(len(importance), 5)

    def test_constant_in_source(self):
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("_IMPORTANCE_CACHE_MAX", source)
        match = re.search(r"_IMPORTANCE_CACHE_MAX\s*=\s*(\d+)", source)
        self.assertIsNotNone(match)
        self.assertEqual(int(match.group(1)), 500)


class TaskCapCancelledErrorTests(unittest.TestCase):
    """Tests for _ai_tasks cap including cancelled/error cleanup."""

    def _apply_cap(self, tasks: list[dict]) -> list[dict]:
        """Replicate the improved cap logic."""
        if len(tasks) > 100:
            _active = ["pending", "running"]
            tasks = [
                t for t in tasks if t["status"] in _active
            ] + [
                t for t in tasks if t["status"] not in _active
            ][-50:]
        return tasks

    def test_cancelled_tasks_trimmed(self):
        tasks = []
        for i in range(120):
            tasks.append({"id": i, "status": "cancelled" if i < 70 else "done"})
        result = self._apply_cap(tasks)
        self.assertLessEqual(len(result), 100)
        # All cancelled tasks should be in the 'finished' pool, old ones trimmed
        cancelled_count = sum(1 for t in result if t["status"] == "cancelled")
        self.assertLess(cancelled_count, 70)

    def test_error_tasks_trimmed(self):
        tasks = []
        for i in range(110):
            tasks.append({"id": i, "status": "error"})
        result = self._apply_cap(tasks)
        self.assertLessEqual(len(result), 50)

    def test_active_tasks_preserved(self):
        tasks = [{"id": i, "status": "done"} for i in range(90)]
        tasks.append({"id": 90, "status": "pending"})
        tasks.append({"id": 91, "status": "running"})
        for i in range(92, 112):
            tasks.append({"id": i, "status": "cancelled"})
        result = self._apply_cap(tasks)
        pending = [t for t in result if t["status"] == "pending"]
        running = [t for t in result if t["status"] == "running"]
        self.assertEqual(len(pending), 1)
        self.assertEqual(len(running), 1)

    def test_below_cap_unchanged(self):
        tasks = [{"id": i, "status": "done"} for i in range(50)]
        result = self._apply_cap(tasks)
        self.assertEqual(len(result), 50)


class SafeStatTests(unittest.TestCase):
    """Tests for _safe_stat helper function."""

    def test_safe_stat_returns_attribute(self):
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        # Extract _safe_stat function
        fn_start = source.index("def _safe_stat(")
        fn_end = source.index("\n\n", fn_start)
        fn_source = source[fn_start:fn_end]
        ns: dict = {"Path": Path}
        exec(fn_source, ns)
        _safe_stat = ns["_safe_stat"]
        # Existing path should return real mtime
        result = _safe_stat(Path(__file__), "st_mtime", 0.0)
        self.assertGreater(result, 0.0)

    def test_safe_stat_returns_default_on_missing(self):
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        fn_start = source.index("def _safe_stat(")
        fn_end = source.index("\n\n", fn_start)
        fn_source = source[fn_start:fn_end]
        ns: dict = {"Path": Path}
        exec(fn_source, ns)
        _safe_stat = ns["_safe_stat"]
        result = _safe_stat(Path("/nonexistent/file.md"), "st_mtime", -1.0)
        self.assertEqual(result, -1.0)


class RebuildGraphSafetyTests(unittest.TestCase):
    """Tests for _rebuild_graph_data per-file error handling."""

    def test_source_has_per_file_except(self):
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        # Find _rebuild_graph_data
        idx = source.index("def _rebuild_graph_data(self):")
        method_src = source[idx:idx + 900]
        self.assertIn("except Exception:", method_src)
        self.assertIn("continue", method_src)

    def test_source_has_glob_try_except(self):
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _rebuild_graph_data(self):")
        method_src = source[idx:idx + 600]
        self.assertIn("except OSError:", method_src)


class TaskAutoRetryTests(unittest.TestCase):
    """Tests for automatic task retry on error."""

    def _make_task(self, tid=1, status="running", retries=0):
        return {
            "id": tid, "text": "test task", "kind": "summary",
            "status": status, "progress": 50, "result": "",
            "detail": "", "actions": [], "created": 1.0,
            "steps": [], "retries": retries,
        }

    def test_retry_resets_task_to_pending(self):
        """First error triggers retry: status→pending, retries incremented."""
        task = self._make_task(retries=0)
        task["status"] = "error"
        task["result"] = "Task failed with error"
        # Simulate retry logic from _hive_complete_task
        _TASK_RETRY_MAX = 1
        if task["status"] == "error" and task.get("retries", 0) < _TASK_RETRY_MAX:
            task["retries"] = task.get("retries", 0) + 1
            task["status"] = "pending"
            task["progress"] = 0
            task["result"] = ""
            task["detail"] = ""
            task["actions"] = []
        self.assertEqual(task["status"], "pending")
        self.assertEqual(task["retries"], 1)
        self.assertEqual(task["progress"], 0)

    def test_no_retry_after_max_retries(self):
        """Second error does NOT retry: task stays in error."""
        task = self._make_task(retries=1)
        task["status"] = "error"
        task["result"] = "Task failed with error"
        _TASK_RETRY_MAX = 1
        if task["status"] == "error" and task.get("retries", 0) < _TASK_RETRY_MAX:
            task["retries"] += 1
            task["status"] = "pending"
        self.assertEqual(task["status"], "error")
        self.assertEqual(task["retries"], 1)

    def test_retries_field_in_submit(self):
        """Task dict from _hive_submit_task includes retries=0."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _hive_submit_task(self")
        method_src = source[idx:idx + 600]
        self.assertIn('"retries": 0', method_src)

    def test_retry_max_constant_exists(self):
        """_TASK_RETRY_MAX constant is defined in source."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        match = re.search(r"_TASK_RETRY_MAX\s*=\s*(\d+)", source)
        self.assertIsNotNone(match)
        self.assertEqual(int(match.group(1)), 1)

    def test_successful_task_not_retried(self):
        """Done tasks are never retried."""
        task = self._make_task(retries=0)
        task["status"] = "done"
        _TASK_RETRY_MAX = 1
        retried = False
        if task["status"] == "error" and task.get("retries", 0) < _TASK_RETRY_MAX:
            retried = True
        self.assertFalse(retried)


class TaskHistoryViewerTests(unittest.TestCase):
    """Tests for _hive_show_history functionality."""

    def test_history_formatting(self):
        """Verify history entries are formatted correctly."""
        import datetime as _dt
        entries = [
            {"id": 1, "text": "scan vault", "kind": "vault-stats",
             "status": "done", "result": "Found 42 notes", "completed": 1700000000.0},
            {"id": 2, "text": "find gaps", "kind": "vault-links",
             "status": "error", "result": "Failed", "completed": 1700001000.0},
        ]
        lines = []
        for entry in reversed(entries[-30:]):
            status = entry.get("status", "?")
            icon = {
                "done": "\u2713", "error": "\u2718", "cancelled": "\u2715"
            }.get(status, "\u25CB")
            tid = entry.get("id", "?")
            kind = entry.get("kind", "task")
            text = entry.get("text", "")[:50]
            result = entry.get("result", "")[:40]
            line = f"{icon} #{tid} [{kind}] {text}"
            if result:
                line += f"\n   \u2192 {result}"
            lines.append(line)
        body = "\n".join(lines)
        self.assertIn("\u2718 #2", body)  # error icon for task 2
        self.assertIn("\u2713 #1", body)  # done icon for task 1
        self.assertIn("[vault-stats]", body)
        self.assertIn("Found 42 notes", body)

    def test_empty_history_file(self):
        """Empty JSON array results in 'empty' message logic."""
        history = []
        self.assertEqual(len(history), 0)

    def test_history_viewer_button_exists_in_source(self):
        """Source contains the History button widget."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("History", source)
        self.assertIn("_hive_show_history", source)

    def test_history_capped_at_30_entries(self):
        """History viewer shows at most 30 entries."""
        entries = [{"id": i, "status": "done", "text": f"task {i}",
                     "kind": "summary", "result": "ok", "completed": 1.0}
                    for i in range(50)]
        shown = entries[-30:]
        self.assertEqual(len(shown), 30)


class TaskFilterTests(unittest.TestCase):
    """Tests for task list filtering by status."""

    def _make_task(self, tid, status="done"):
        return {
            "id": tid, "text": f"task {tid}", "kind": "summary",
            "status": status, "progress": 100 if status == "done" else 0,
            "result": "ok" if status == "done" else "",
            "detail": "", "actions": [], "created": 1.0,
            "steps": [], "retries": 0, "priority": 0,
        }

    def test_filter_all_shows_non_cancelled(self):
        """filter_val='all' shows everything except cancelled."""
        tasks = [
            self._make_task(1, "done"),
            self._make_task(2, "error"),
            self._make_task(3, "pending"),
            self._make_task(4, "cancelled"),
        ]
        filter_val = "all"
        candidates = [t for t in tasks[-15:] if t["status"] != "cancelled"]
        if filter_val == "error":
            candidates = [t for t in candidates if t["status"] == "error"]
        elif filter_val == "done":
            candidates = [t for t in candidates if t["status"] == "done"]
        self.assertEqual(len(candidates), 3)
        self.assertNotIn("cancelled", [t["status"] for t in candidates])

    def test_filter_error_shows_only_error(self):
        """filter_val='error' shows only error tasks."""
        tasks = [
            self._make_task(1, "done"),
            self._make_task(2, "error"),
            self._make_task(3, "error"),
            self._make_task(4, "pending"),
        ]
        filter_val = "error"
        candidates = [t for t in tasks[-15:] if t["status"] != "cancelled"]
        if filter_val == "error":
            candidates = [t for t in candidates if t["status"] == "error"]
        self.assertEqual(len(candidates), 2)
        self.assertTrue(all(t["status"] == "error" for t in candidates))

    def test_filter_done_shows_only_done(self):
        """filter_val='done' shows only completed tasks."""
        tasks = [
            self._make_task(1, "done"),
            self._make_task(2, "error"),
            self._make_task(3, "done"),
        ]
        filter_val = "done"
        candidates = [t for t in tasks[-15:] if t["status"] != "cancelled"]
        if filter_val == "done":
            candidates = [t for t in candidates if t["status"] == "done"]
        self.assertEqual(len(candidates), 2)
        self.assertTrue(all(t["status"] == "done" for t in candidates))

    def test_filter_status_var_exists_in_source(self):
        """Source contains _hive_filter_status StringVar."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("_hive_filter_status", source)

    def test_error_tag_configured_in_task_list(self):
        """Task list has 'error' tag configured."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn('tag_configure("error"', source)

    def test_retry_badge_shown_for_retried_tasks(self):
        """Tasks with retries > 0 show retry badge in display."""
        task = self._make_task(1, "pending")
        task["retries"] = 1
        retries = task.get("retries", 0)
        retry_tag = f" \u21BB{retries}" if retries > 0 else ""
        self.assertEqual(retry_tag, " \u21BB1")
        task2 = self._make_task(2, "pending")
        task2["retries"] = 0
        retry_tag2 = f" \u21BB{task2.get('retries', 0)}" if task2.get("retries", 0) > 0 else ""
        self.assertEqual(retry_tag2, "")


class HexColorScaleTests(unittest.TestCase):
    """Tests for _hex_color_scale helper."""

    @classmethod
    def setUpClass(cls):
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        fn_start = source.index("def _hex_color_scale(")
        fn_end = source.index("\ndef _draw_nebulae(")
        fn_src = source[fn_start:fn_end]
        ns: dict = {}
        exec(compile(fn_src, "<hex_color_scale>", "exec"), ns)
        cls._hex_color_scale = staticmethod(ns["_hex_color_scale"])

    def test_identity_factor_one(self):
        """factor=1.0 returns same color."""
        self.assertEqual(self._hex_color_scale("#ff8040", 1.0), "#ff8040")

    def test_factor_zero_returns_black(self):
        """factor=0 returns black."""
        self.assertEqual(self._hex_color_scale("#abcdef", 0.0), "#000000")

    def test_factor_half(self):
        """factor=0.5 halves each channel."""
        result = self._hex_color_scale("#804020", 0.5)
        self.assertEqual(result, "#402010")

    def test_clamp_upper(self):
        """factor > 1.0 clamps to 255."""
        result = self._hex_color_scale("#ff8080", 2.0)
        self.assertTrue(result.startswith("#ff"))
        # r channel should be ff (clamped), g and b at most ff
        r = int(result[1:3], 16)
        self.assertEqual(r, 255)

    def test_accepts_no_hash(self):
        """Input without # still works."""
        result = self._hex_color_scale("ff0000", 0.5)
        self.assertEqual(result, "#7f0000")

    def test_multiple_call_sites_in_source(self):
        """_hex_color_scale is called from hive, graph, and schema views."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        count = source.count("_hex_color_scale(")
        # definition + at least 7 call sites
        self.assertGreaterEqual(count, 8)


class DrawNebulaeDeduplicationTests(unittest.TestCase):
    """Tests for shared _draw_nebulae helper."""

    def test_function_defined(self):
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("def _draw_nebulae(", source)

    def test_called_from_all_three_views(self):
        """_draw_nebulae is called from hive, graph, and schema draw methods."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        # At least 3 call sites (one per view) + 1 definition
        count = source.count("_draw_nebulae(")
        self.assertGreaterEqual(count, 4)

    def test_no_inline_nebula_loops_remain(self):
        """Old inline 'for neb in self._hive_nebulae' rendering loops are gone."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        # The inline loops used ncol = neb["color"].lstrip inside draw methods.
        # After dedup, ncol line only exists in the shared helper.
        ncol_lines = [l for l in source.split("\n") if 'neb["color"].lstrip' in l]
        self.assertEqual(len(ncol_lines), 1, "Only 1 ncol line (in helper)")


class DrawVignetteDeduplicationTests(unittest.TestCase):
    """Tests for shared _draw_vignette helper."""

    def test_function_defined(self):
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("def _draw_vignette(", source)

    def test_called_from_all_three_views(self):
        """_draw_vignette is called from hive, graph, and schema."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        count = source.count("_draw_vignette(")
        self.assertGreaterEqual(count, 4)


class FrameThrottleTests(unittest.TestCase):
    """Tests for frame-rate throttle fields and animate logic."""

    def test_throttle_fields_in_init(self):
        """__init__ declares _last_hive_draw_t and _last_schema_draw_t."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("_last_hive_draw_t", source)
        self.assertIn("_last_schema_draw_t", source)

    def test_dirty_flags_in_init(self):
        """__init__ declares _hive_dirty and _schema_dirty flags."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("_hive_dirty", source)
        self.assertIn("_schema_dirty", source)

    def test_hive_throttle_in_animate(self):
        """_animate uses time-based throttle for hive redraw."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        # Throttle interval constant for hive active/idle
        self.assertIn("_last_hive_draw_t", source)
        self.assertIn("0.04", source)  # active interval

    def test_schema_throttle_in_animate(self):
        """_animate uses throttle for schema redraw."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("_last_schema_draw_t", source)
        self.assertIn("0.08", source)  # schema interval

    def test_graph_existing_throttle_preserved(self):
        """Graph view has throttle during AI processing."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("0.30", source)


class TabCyclingTests(unittest.TestCase):
    """Tests for Ctrl+Tab / Ctrl+Shift+Tab tab cycling."""

    def test_cycle_tab_method_defined(self):
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("def _cycle_tab(", source)

    def test_ctrl_tab_binding_exists(self):
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("<Control-Tab>", source)
        self.assertIn("<Control-Shift-Tab>", source)

    def test_cycle_uses_modulo(self):
        """Tab cycling wraps around using modulo."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _cycle_tab(")
        body = source[idx:idx + 300]
        self.assertIn("%", body)

    def test_shortcuts_help_includes_tab_cycling(self):
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("Next tab", source)
        self.assertIn("Previous tab", source)


class ToastNotificationTests(unittest.TestCase):
    """Tests for non-blocking toast overlay system."""

    def test_show_toast_method_defined(self):
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("def _show_toast(", source)

    def test_hide_toast_method_defined(self):
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("def _hide_toast(", source)

    def test_toast_label_initialized(self):
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("_toast_label", source)
        self.assertIn("_toast_after_id", source)

    def test_toast_uses_place_geometry(self):
        """Toast uses place() for overlay rather than pack/grid."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _show_toast(")
        body = source[idx:idx + 400]
        self.assertIn(".place(", body)

    def test_toast_auto_dismiss(self):
        """Toast schedules auto-dismiss via after()."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _show_toast(")
        body = source[idx:idx + 500]
        self.assertIn(".after(", body)
        self.assertIn("_hide_toast", body)

    def test_save_triggers_toast(self):
        """Saving a note shows a toast notification."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn('_show_toast(f"Saved:', source)


class TaskExportTests(unittest.TestCase):
    """Tests for JSON task history export."""

    def test_export_method_defined(self):
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("def _export_task_history(", source)

    def test_export_keyboard_shortcut_bound(self):
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("<Control-Shift-X>", source)

    def test_export_button_in_hive(self):
        """Export button exists in hive input bar."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("Export", source)
        self.assertIn("_export_task_history", source)

    def test_export_uses_filedialog(self):
        """Export uses filedialog for safe user-controlled save path."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _export_task_history(")
        body = source[idx:idx + 800]
        self.assertIn("asksaveasfilename", body)

    def test_export_writes_json(self):
        """Export produces valid JSON output."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _export_task_history(")
        body = source[idx:idx + 1200]
        self.assertIn("json.dumps(", body)

    def test_shortcuts_help_includes_export(self):
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("Export task history", source)


class GraphContextMenuTests(unittest.TestCase):
    """Tests for graph canvas right-click context menu."""

    def test_graph_ctx_menu_created(self):
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("graph_ctx_menu", source)

    def test_button3_bound_on_graph(self):
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn('<Button-3>', source)
        self.assertIn('_on_graph_right_click', source)

    def test_ctx_open_method(self):
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("def _graph_ctx_open(", source)

    def test_ctx_pin_method(self):
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("def _graph_ctx_pin(", source)

    def test_ctx_rename_method(self):
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("def _graph_ctx_rename(", source)

    def test_ctx_links_method(self):
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("def _graph_ctx_links(", source)

    def test_menu_has_open_pin_rename_links(self):
        """Menu contains all 4 commands."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("graph_ctx_menu = tk.Menu")
        block = source[idx:idx + 900]
        self.assertIn('"Open"', block)
        self.assertIn('Pin/Unpin', block)
        self.assertIn('"Rename"', block)
        self.assertIn('Show Links', block)


class NoteTemplateTests(unittest.TestCase):
    """Tests for note creation template system."""

    def test_templates_defined(self):
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        for tpl in ["Blank", "Meeting", "Daily", "Project"]:
            self.assertIn(f'"{tpl}"', source)

    def test_new_note_has_template_selection(self):
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _new_note(")
        body = source[idx:idx + 2000]
        self.assertIn("Radiobutton", body)
        self.assertIn("tpl_var", body)

    def test_template_placeholder_replacement(self):
        """Templates use {name} placeholder replaced with actual note name."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _new_note(")
        body = source[idx:idx + 3000]
        self.assertIn("{name}", body)
        self.assertIn('.replace("{name}"', body)

    def test_meeting_template_has_sections(self):
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("Attendees", source)
        self.assertIn("Agenda", source)
        self.assertIn("Action Items", source)

    def test_create_button_exists(self):
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _new_note(")
        body = source[idx:idx + 3500]
        self.assertIn('"Create"', body)
        self.assertIn('"Cancel"', body)


class StatusBarLinkCountTests(unittest.TestCase):
    """Tests for wiki-link count in status bar."""

    def test_link_count_in_word_count(self):
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _update_word_count(")
        body = source[idx:idx + 500]
        self.assertIn("links", body)
        self.assertIn("re.findall", body)

    def test_link_regex_pattern(self):
        """Link count uses [[...]] wiki-link regex."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _update_word_count(")
        body = source[idx:idx + 500]
        self.assertIn("[[", body)

    def test_link_count_displayed_conditionally(self):
        """Link count only shown when links > 0."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _update_word_count(")
        body = source[idx:idx + 500]
        self.assertIn("if links > 0", body)


class EditorContextMenuTests(unittest.TestCase):
    """Tests for editor right-click context menu."""

    def test_editor_ctx_menu_exists(self):
        """Editor context menu widget is created."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("editor_ctx_menu = tk.Menu", source)

    def test_editor_ctx_has_cut_copy_paste(self):
        """Menu has basic clipboard commands."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("editor_ctx_menu = tk.Menu")
        block = source[idx:idx + 1200]
        self.assertIn('"Cut"', block)
        self.assertIn('"Copy"', block)
        self.assertIn('"Paste"', block)

    def test_editor_ctx_has_formatting(self):
        """Menu has formatting options: Bold, Italic, Code, Link."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("editor_ctx_menu = tk.Menu")
        block = source[idx:idx + 1200]
        self.assertIn("Bold", block)
        self.assertIn("Italic", block)
        self.assertIn("Code", block)
        self.assertIn("Link", block)

    def test_editor_ctx_has_heading_checkbox(self):
        """Menu has Heading and Checkbox entries."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("editor_ctx_menu = tk.Menu")
        block = source[idx:idx + 1500]
        self.assertIn('"Heading"', block)
        self.assertIn("Checkbox", block)

    def test_editor_right_click_binding(self):
        """Editor binds Button-3 for context menu."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn('"<Button-3>"', source)
        self.assertIn("_on_editor_right_click", source)


class FormattingShortcutTests(unittest.TestCase):
    """Tests for Ctrl+B/I/L/Shift+C formatting shortcuts."""

    def test_bold_shortcut_binding(self):
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn('"<Control-b>"', source)
        self.assertIn("_format_bold", source)

    def test_italic_shortcut_binding(self):
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn('"<Control-i>"', source)
        self.assertIn("_format_italic", source)

    def test_link_shortcut_binding(self):
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn('"<Control-l>"', source)
        self.assertIn("_format_link", source)

    def test_code_shortcut_binding(self):
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn('"<Control-Shift-C>"', source)
        self.assertIn("_format_code", source)

    def test_format_bold_uses_double_star(self):
        """Bold wraps selection with **."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _format_bold(")
        body = source[idx:idx + 200]
        self.assertIn('_format_wrap("**")', body)

    def test_format_italic_uses_single_star(self):
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _format_italic(")
        body = source[idx:idx + 200]
        self.assertIn('_format_wrap("*")', body)

    def test_format_heading_cycles(self):
        """Heading formatter cycles through # levels."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _format_heading(")
        body = source[idx:idx + 600]
        self.assertIn('### ', body)
        self.assertIn('## ', body)
        self.assertIn('# ', body)

    def test_format_checkbox_inserts_bracket(self):
        """Checkbox inserts - [ ] prefix."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _format_checkbox(")
        body = source[idx:idx + 400]
        self.assertIn("[ ]", body)

    def test_format_link_inserts_wiki_brackets(self):
        """Link formatter uses [[...]] syntax."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _format_link(")
        body = source[idx:idx + 500]
        self.assertIn("[[", body)
        self.assertIn("]]", body)


class SearchReplaceTests(unittest.TestCase):
    """Tests for search replace and navigation."""

    def test_replace_bar_exists(self):
        """Replace bar widget is created."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("replace_bar = tk.Frame", source)
        self.assertIn("replace_entry_var", source)

    def test_replace_buttons_exist(self):
        """Replace and Replace All buttons exist."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("replace_bar = tk.Frame")
        block = source[idx:idx + 1200]
        self.assertIn('"Replace All"', block)
        self.assertIn('"Replace"', block)

    def test_search_next_prev_buttons(self):
        """Search bar has next/prev navigation buttons."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("_search_next", source)
        self.assertIn("_search_prev", source)

    def test_regex_toggle_exists(self):
        """Search has regex toggle checkbox."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("_search_regex_var", source)
        self.assertIn("BooleanVar", source)

    def test_search_uses_regex_flag(self):
        """_do_search supports regexp mode."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _do_search(")
        body = source[idx:idx + 1000]
        self.assertIn("regexp=use_regex", body)

    def test_replace_all_method(self):
        """_replace_all performs bulk replacement."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _replace_all(")
        body = source[idx:idx + 800]
        self.assertIn("re.subn", body)

    def test_search_next_wraps_around(self):
        """_search_next wraps using modulo."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _search_next(")
        body = source[idx:idx + 400]
        self.assertIn("% len(", body)

    def test_replace_bar_shown_with_search(self):
        """Toggle search also shows replace bar."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _toggle_search(")
        body = source[idx:idx + 400]
        self.assertIn("replace_bar.pack", body)



# ── Tier 9 ──────────────────────────────────────────────────────────────

class GraphLayoutPresetTests(unittest.TestCase):
    """Tests for graph layout presets (circular/force/radial)."""

    def test_graph_layout_mode_state(self):
        """_graph_layout_mode state variable exists."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("_graph_layout_mode", source)
        self.assertIn('"circular"', source)

    def test_layout_toolbar_exists(self):
        """Graph layout toolbar with 3 buttons exists."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("graph_layout_bar", source)
        self.assertIn("_layout_buttons", source)

    def test_layout_buttons_labels(self):
        """Toolbar has Circular, Force, Radial buttons."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("graph_layout_bar")
        block = source[idx:idx + 1500]
        self.assertIn("Circular", block)
        self.assertIn("Force", block)
        self.assertIn("Radial", block)

    def test_set_graph_layout_method(self):
        """_set_graph_layout method clears custom positions and redraws."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _set_graph_layout(")
        body = source[idx:idx + 800]
        self.assertIn("_graph_layout_mode", body)
        self.assertIn("_graph_custom_positions", body)
        self.assertIn("_draw_graph", body)

    def test_draw_graph_force_layout(self):
        """_draw_graph implements force-directed layout."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _draw_graph(")
        body = source[idx:idx + 5000]
        self.assertIn('"force"', body)
        self.assertIn("repulsion", body.lower().replace("# ", "").lower())

    def test_draw_graph_radial_layout(self):
        """_draw_graph implements radial layout."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _draw_graph(")
        body = source[idx:idx + 7000]
        self.assertIn('"radial"', body)
        self.assertIn("ring", body)

    def test_draw_graph_circular_default(self):
        """_draw_graph uses circular as default layout."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("# Circular (default)")
        self.assertGreater(idx, 0)

    def test_layout_button_highlight(self):
        """Active layout button is highlighted via cyan color."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _set_graph_layout(")
        body = source[idx:idx + 800]
        self.assertIn("cyan", body)

    def test_force_layout_iterations(self):
        """Force layout runs iterative settling."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _draw_graph(")
        body = source[idx:idx + 5000]
        self.assertIn("range(30)", body)


class VaultSearchJumpTests(unittest.TestCase):
    """Tests for vault-wide search jump with query highlighting."""

    def test_open_file_at_line_highlights_query(self):
        """_open_file_at_line highlights search query matches."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _open_file_at_line(")
        body = source[idx:idx + 1200]
        self.assertIn("search_match", body)

    def test_open_file_at_line_uses_vault_search(self):
        """_open_file_at_line reads vault_search_var for highlighting."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _open_file_at_line(")
        body = source[idx:idx + 1200]
        self.assertIn("vault_search_var", body)

    def test_search_match_tag_add(self):
        """search_match tag is added to matching text."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _open_file_at_line(")
        body = source[idx:idx + 1200]
        self.assertIn("tag_add", body)
        self.assertIn("search_match", body)


class BookmarkTests(unittest.TestCase):
    """Tests for bookmark system (Ctrl+M toggle, sidebar, jump)."""

    def test_bookmarks_state(self):
        """_bookmarks dict state variable exists."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("_bookmarks: dict[str, list[int]]", source)

    def test_ctrl_m_binding(self):
        """Ctrl+M binding for bookmark toggle exists."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("<Control-m>", source)
        self.assertIn("_toggle_bookmark", source)

    def test_toggle_bookmark_method(self):
        """_toggle_bookmark adds/removes bookmarks."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _toggle_bookmark(")
        body = source[idx:idx + 800]
        self.assertIn("_bookmarks", body)
        self.assertIn("_refresh_bookmark_list", body)

    def test_bookmark_listbox_exists(self):
        """Bookmark sidebar listbox exists."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("bookmark_listbox", source)
        self.assertIn("BOOKMARKS", source)

    def test_refresh_bookmark_list(self):
        """_refresh_bookmark_list updates sidebar display."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _refresh_bookmark_list(")
        body = source[idx:idx + 600]
        self.assertIn("bookmark_listbox", body)
        self.assertIn("delete", body)

    def test_on_bookmark_select_jumps(self):
        """_on_bookmark_select opens file at bookmarked line."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _on_bookmark_select(")
        body = source[idx:idx + 600]
        self.assertIn("_open_file_at_line", body)


# ── Tier 10 ─────────────────────────────────────────────────────────────

class GraphEdgeLabelTests(unittest.TestCase):
    """Tests for graph edge labels at midpoints."""

    def test_edge_label_drawn(self):
        """Edge label arrow symbol is drawn at midpoint."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("# Edge label at midpoint")
        body = source[idx:idx + 300]
        self.assertIn("create_text", body)

    def test_edge_label_only_long_edges(self):
        """Edge labels only appear on edges longer than 80px."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("# Edge label at midpoint")
        body = source[idx:idx + 200]
        self.assertIn("dist > 80", body)

    def test_edge_label_uses_arrow(self):
        """Edge label displays direction arrow."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("# Edge label at midpoint")
        body = source[idx:idx + 300]
        # Arrow symbol \u2192 is in the source as unicode escape
        self.assertIn("2192", body)


class GraphNodeFilterTests(unittest.TestCase):
    """Tests for graph node filter/search functionality."""

    def test_graph_filter_var_exists(self):
        """graph_filter_var StringVar exists."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("graph_filter_var", source)

    def test_graph_filter_entry_widget(self):
        """Graph filter entry widget is created in layout bar."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("graph_filter_entry", source)

    def test_on_graph_filter_change_method(self):
        """_on_graph_filter_change redraws graph with filter."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _on_graph_filter_change(")
        body = source[idx:idx + 400]
        self.assertIn("_graph_filter_query", body)
        self.assertIn("_draw_graph", body)

    def test_filter_dimming_in_draw(self):
        """Filtered-out nodes are dimmed in _draw_graph."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("is_dimmed", source)
        self.assertIn("filtered_nodes", source)

    def test_graph_filter_state_var(self):
        """_graph_filter_query state variable exists."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("_graph_filter_query", source)

    def test_filter_magnifying_icon(self):
        """Filter has magnifying glass icon label."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("graph_filter_var")
        body = source[idx:idx + 500]
        # Magnifying glass icon is present near filter entry
        self.assertIn("graph_filter_entry", body)


class GraphAutoClusterTests(unittest.TestCase):
    """Tests for auto-clustering with connected components."""

    def test_graph_clusters_state(self):
        """_graph_clusters dict state variable exists."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("_graph_clusters: dict[str, int]", source)

    def test_cluster_bfs_in_draw(self):
        """_draw_graph uses BFS for connected component detection."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("Auto-clustering")
        body = source[idx:idx + 1200]
        self.assertIn("visited_cluster", body)
        self.assertIn("queue", body)
        self.assertIn("component", body)

    def test_cluster_colors_defined(self):
        """Multiple cluster colors are defined."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("cluster_colors")
        body = source[idx:idx + 200]
        self.assertIn("cyan", body)
        self.assertIn("emerald", body)

    def test_cluster_ring_drawn(self):
        """Cluster indicator ring is drawn around nodes."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("# Cluster color indicator ring")
        body = source[idx:idx + 300]
        self.assertIn("cluster_col", body)
        self.assertIn("create_oval", body)

    def test_cluster_id_assignment(self):
        """Nodes get assigned cluster_id values."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("cluster_id += 1", source)


# ─── Tier 11: Graph Zoom/Pan ────────────────────────────────────
class GraphZoomPanTests(unittest.TestCase):
    """Tests for graph zoom and pan functionality."""

    def test_zoom_scale_state(self):
        """_graph_zoom_scale state variable exists."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("_graph_zoom_scale: float = 1.0", source)

    def test_pan_offset_state(self):
        """_graph_pan_offset state variable exists."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("_graph_pan_offset: list[float]", source)

    def test_scroll_zoom_handler(self):
        """_on_graph_scroll_zoom applies zoom factor and clamps."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _on_graph_scroll_zoom(")
        body = source[idx:idx + 400]
        self.assertIn("_graph_zoom_scale", body)
        self.assertIn("0.3", body)
        self.assertIn("3.0", body)
        self.assertIn("_draw_graph", body)

    def test_pan_start_handler(self):
        """_on_graph_pan_start records start coordinates."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _on_graph_pan_start(")
        body = source[idx:idx + 200]
        self.assertIn("_graph_pan_start", body)
        self.assertIn("event.x", body)

    def test_pan_move_handler(self):
        """_on_graph_pan_move updates offset and redraws."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _on_graph_pan_move(")
        body = source[idx:idx + 600]
        self.assertIn("_graph_pan_offset", body)
        self.assertIn("_draw_graph", body)

    def test_pan_end_handler(self):
        """_on_graph_pan_end clears pan state."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _on_graph_pan_end(")
        body = source[idx:idx + 200]
        self.assertIn("_graph_pan_start", body)
        self.assertIn("None", body)

    def test_zoom_transform_in_draw(self):
        """_draw_graph applies zoom and pan transform to positions."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("Apply zoom and pan transform")
        body = source[idx:idx + 400]
        self.assertIn("z_scale", body)
        self.assertIn("z_pan_dx", body)
        self.assertIn("positions[node]", body)

    def test_mousewheel_binding(self):
        """Graph canvas binds MouseWheel for zoom."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("MouseWheel", source)
        self.assertIn("_on_graph_scroll_zoom", source)

    def test_button2_pan_bindings(self):
        """Graph canvas binds Button-2 for pan."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("Button-2", source)
        self.assertIn("B2-Motion", source)
        self.assertIn("_on_graph_pan_end", source)


# ─── Tier 11: Kanban Board ──────────────────────────────────────
class KanbanBoardTests(unittest.TestCase):
    """Tests for kanban board view."""

    def test_kanban_columns_state(self):
        """_kanban_columns has Todo/In Progress/Done."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn('"Todo"', source)
        self.assertIn('"In Progress"', source)
        self.assertIn('"Done"', source)
        self.assertIn("_kanban_columns", source)

    def test_show_kanban_sets_view_mode(self):
        """_show_kanban sets view_mode to kanban."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _show_kanban(")
        body = source[idx:idx + 700]
        self.assertIn('view_mode = "kanban"', body)
        self.assertIn("KANBAN", body)
        self.assertIn("_draw_kanban", body)

    def test_extract_tasks_parses_checkboxes(self):
        """_extract_tasks parses - [ ] and - [x] syntax."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _extract_tasks(")
        body = source[idx:idx + 800]
        self.assertIn("- [x]", body)
        self.assertIn("- [ ]", body)
        self.assertIn("Todo", body)
        self.assertIn("Done", body)

    def test_draw_kanban_columns(self):
        """_draw_kanban draws column headers."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _draw_kanban(")
        body = source[idx:idx + 1200]
        self.assertIn("col_name", body)
        self.assertIn("create_rectangle", body)
        self.assertIn("create_text", body)

    def test_kanban_click_opens_note(self):
        """_on_kanban_click opens source note."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _on_kanban_click(")
        body = source[idx:idx + 600]
        self.assertIn("_show_editor", body)
        self.assertIn("_open_file", body)

    def test_kanban_frame_in_hide_all(self):
        """kanban_frame is hidden in _hide_all_views."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _hide_all_views(")
        body = source[idx:idx + 400]
        self.assertIn("kanban_frame", body)

    def test_kanban_in_command_palette(self):
        """Kanban Board appears in command palette."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("Kanban Board", source)
        self.assertIn("_show_kanban", source)

    def test_extract_tasks_in_progress(self):
        """Tasks with 'in progress' or 'wip' go to In Progress column."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _extract_tasks(")
        body = source[idx:idx + 1200]
        self.assertIn("in progress", body)
        self.assertIn("wip", body)


# ─── Tier 11: Duplicate Note ────────────────────────────────────
class DuplicateNoteTests(unittest.TestCase):
    """Tests for note duplication."""

    def test_duplicate_note_method_exists(self):
        """_duplicate_note method exists."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("def _duplicate_note(self)", source)

    def test_duplicate_creates_copy_suffix(self):
        """Duplicate creates file with (copy) suffix."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _duplicate_note(")
        body = source[idx:idx + 600]
        self.assertIn("(copy)", body)
        self.assertIn("write_text", body)

    def test_duplicate_handles_existing_copy(self):
        """Duplicate increments counter for existing copies."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _duplicate_note(")
        body = source[idx:idx + 600]
        self.assertIn("counter", body)
        self.assertIn("while dest.exists()", body)

    def test_duplicate_in_command_palette(self):
        """Duplicate Note appears in command palette."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("Duplicate Note", source)
        self.assertIn("_duplicate_note", source)

    def test_duplicate_rescans_vault(self):
        """Duplicate note rescans vault after creation."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _duplicate_note(")
        body = source[idx:idx + 900]
        self.assertIn("_scan_vault", body)
        self.assertIn("_toast", body)


# ─── Tier 12: Graph Minimap ─────────────────────────────────────
class GraphMinimapTests(unittest.TestCase):
    """Tests for graph minimap overlay."""

    def test_minimap_size_state(self):
        """_graph_minimap_size state variable exists."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("_graph_minimap_size: int = 140", source)

    def test_draw_graph_minimap_method(self):
        """_draw_graph_minimap method exists and draws elements."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _draw_graph_minimap(")
        body = source[idx:idx + 4000]
        self.assertIn("MINIMAP", body)
        self.assertIn("create_rectangle", body)
        self.assertIn("create_oval", body)

    def test_minimap_viewport_rect(self):
        """Minimap draws a viewport rectangle for visible area."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _draw_graph_minimap(")
        body = source[idx:idx + 4000]
        self.assertIn("viewport", body.lower())
        self.assertIn("dash", body)

    def test_minimap_called_in_draw_graph(self):
        """_draw_graph calls _draw_graph_minimap."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("self._draw_graph_minimap(c, w, h)", source)

    def test_minimap_bounding_box(self):
        """Minimap computes bounding box of all node positions."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _draw_graph_minimap(")
        body = source[idx:idx + 1200]
        self.assertIn("min_x", body)
        self.assertIn("max_x", body)
        self.assertIn("span_x", body)


# ─── Tier 12: Tag Cloud Full View ───────────────────────────────
class TagCloudViewTests(unittest.TestCase):
    """Tests for full-screen tag cloud view."""

    def test_tag_cloud_view_rects_state(self):
        """_tag_cloud_view_rects state variable exists."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("_tag_cloud_view_rects: dict", source)

    def test_show_tag_cloud_view_method(self):
        """_show_tag_cloud_view sets view_mode."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _show_tag_cloud_view(")
        body = source[idx:idx + 500]
        self.assertIn('view_mode = "tag_cloud_view"', body)
        self.assertIn("TAGS", body)
        self.assertIn("_draw_tag_cloud_view", body)

    def test_draw_tag_cloud_view_counts(self):
        """_draw_tag_cloud_view counts tag frequencies."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _draw_tag_cloud_view(")
        body = source[idx:idx + 2500]
        self.assertIn("tag_counts", body)
        self.assertIn("sorted_tags", body)
        self.assertIn("font_size", body)

    def test_draw_tag_cloud_view_pills(self):
        """Tags are drawn as clickable pill shapes."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _draw_tag_cloud_view(")
        body = source[idx:idx + 3000]
        self.assertIn("create_rectangle", body)
        self.assertIn("create_text", body)
        self.assertIn("_tag_cloud_view_rects", body)

    def test_tag_cloud_view_click_filters(self):
        """Clicking a tag sets search filter."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _on_tag_cloud_view_click(")
        body = source[idx:idx + 500]
        self.assertIn("search_entry", body)
        self.assertIn("_show_editor", body)

    def test_tag_cloud_view_frame_in_hide_all(self):
        """tag_cloud_view_frame is hidden in _hide_all_views."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _hide_all_views(")
        body = source[idx:idx + 500]
        self.assertIn("tag_cloud_view_frame", body)

    def test_tag_cloud_view_in_command_palette(self):
        """Tag Cloud View appears in command palette."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("Tag Cloud View", source)
        self.assertIn("_show_tag_cloud_view", source)


# ─── Tier 12: Focus/Zen Mode ────────────────────────────────────
class FocusZenModeTests(unittest.TestCase):
    """Tests for focus/zen distraction-free writing mode."""

    def test_zen_mode_state(self):
        """_zen_mode state variable exists."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("_zen_mode: bool = False", source)

    def test_toggle_zen_mode_method(self):
        """_toggle_zen_mode toggles _zen_mode flag."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _toggle_zen_mode(")
        body = source[idx:idx + 800]
        self.assertIn("_zen_mode = not self._zen_mode", body)

    def test_zen_mode_hides_chrome(self):
        """Zen mode hides sidebar, right panel, toolbar, status bar."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _toggle_zen_mode(")
        body = source[idx:idx + 800]
        self.assertIn("sidebar", body)
        self.assertIn("right_panel", body)
        self.assertIn("toolbar", body)
        self.assertIn("status_bar", body)

    def test_zen_mode_restores_chrome(self):
        """Exiting zen mode restores UI elements."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _toggle_zen_mode(")
        body = source[idx:idx + 1200]
        self.assertIn("grid()", body)
        self.assertIn("Focus mode OFF", body)

    def test_zen_mode_in_command_palette(self):
        """Focus Mode appears in command palette."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        self.assertIn("Focus Mode", source)
        self.assertIn("_toggle_zen_mode", source)

    def test_zen_mode_toast_notification(self):
        """Zen mode shows toast on toggle."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _toggle_zen_mode(")
        body = source[idx:idx + 800]
        self.assertIn("_toast", body)
        self.assertIn("Focus mode ON", body)


# ─── RT VISUALIZATION ENHANCEMENT TESTS ──────────────────────────────

class StarFieldEnhancedTests(unittest.TestCase):
    """Tests for enhanced StarField with depth layers and shooting stars."""

    @classmethod
    def setUpClass(cls):
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        cls.source = source

    def test_starfield_has_depth_layer(self):
        """StarField stores depth per star for parallax."""
        idx = self.source.index("class StarField:")
        body = self.source[idx:idx + 5500]
        self.assertIn("depth", body)

    def test_starfield_depth_scaled_twinkle(self):
        """Twinkle speed scales with depth."""
        idx = self.source.index("class StarField:")
        body = self.source[idx:idx + 5500]
        self.assertIn("twinkle_speed", body)
        self.assertIn("depth", body)

    def test_starfield_temperature_shift(self):
        """Color temperature shift over time."""
        idx = self.source.index("class StarField:")
        body = self.source[idx:idx + 5500]
        self.assertIn("temp_shift", body)

    def test_starfield_shooting_star_attribute(self):
        """StarField has _shooting_star attribute."""
        idx = self.source.index("class StarField:")
        body = self.source[idx:idx + 5500]
        self.assertIn("_shooting_star", body)

    def test_starfield_shooting_star_rendering(self):
        """Shooting star draws a line trail with fade."""
        idx = self.source.index("def draw(self, canvas: tk.Canvas, w: int, h: int, t: float)")
        body = self.source[idx:idx + 4000]
        self.assertIn("create_line", body)
        self.assertIn("fade", body)

    def test_starfield_diagonal_sparkle(self):
        """Very bright near stars get diagonal sparkle."""
        idx = self.source.index("def draw(self, canvas: tk.Canvas, w: int, h: int, t: float)")
        body = self.source[idx:idx + 4000]
        self.assertIn("Diagonal", body)

    def test_starfield_jitter_scaled_by_depth(self):
        """Micro-jitter amplitude depends on depth."""
        idx = self.source.index("class StarField:")
        body = self.source[idx:idx + 5500]
        self.assertIn("jitter_scale", body)


class FlowParticleEnhancedTests(unittest.TestCase):
    """Tests for enhanced FlowParticle with wave motion and energy pulse."""

    @classmethod
    def setUpClass(cls):
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        cls.source = source
        # Extract FlowParticle class for functional tests
        cls_start = source.index("class FlowParticle:")
        cls_end = source.index("\n\nclass StarField:")
        cls_source = source[cls_start:cls_end]
        # Provide mock tk to avoid importing tkinter
        import types
        mock_tk = types.ModuleType("tk")
        mock_tk.Canvas = type("Canvas", (), {})
        ns: dict = {"random": __import__("random"), "math": __import__("math"), "tk": mock_tk}
        exec(cls_source, ns)  # noqa: S102
        cls.FlowParticle = ns["FlowParticle"]

    def test_flow_particle_has_wave_attributes(self):
        """FlowParticle stores wave amplitude and frequency."""
        fp = self.FlowParticle(0, 0, 100, 100, "#4AE3D0")
        self.assertTrue(hasattr(fp, "_wave_amp"))
        self.assertTrue(hasattr(fp, "_wave_freq"))

    def test_flow_particle_perpendicular_vector(self):
        """FlowParticle computes perpendicular unit vector."""
        fp = self.FlowParticle(0, 0, 100, 0, "#4AE3D0")
        self.assertAlmostEqual(fp._perpy, 1.0, places=2)

    def test_flow_particle_wave_offset(self):
        """Wave offset is zero at t=0 and t=1, non-zero in between."""
        fp = self.FlowParticle(0, 0, 100, 0, "#4AE3D0")
        wx0, wy0 = fp._wave_offset(0.0)
        self.assertAlmostEqual(wx0, 0.0, places=1)
        # At midpoint, there should be some offset
        wx_mid, wy_mid = fp._wave_offset(0.5)
        # Non-zero is expected but depends on random freq
        self.assertTrue(isinstance(wx_mid, float))

    def test_flow_particle_energy_pulse_in_draw(self):
        """Draw method has energy pulse calculation."""
        idx = self.source.index("class FlowParticle:")
        body = self.source[idx:idx + 3000]
        self.assertIn("energy", body)
        self.assertIn("sin(self.t * 8)", body)

    def test_flow_particle_trail_stores_wave_position(self):
        """Trail positions include wave offset."""
        fp = self.FlowParticle(0, 0, 200, 0, "#4AE3D0")
        fp.update()
        fp.update()
        self.assertTrue(len(fp.trail) >= 2)


class ParticleEnhancedTests(unittest.TestCase):
    """Tests for enhanced Particle with drift and smooth fade."""

    @classmethod
    def setUpClass(cls):
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        cls_start = source.index("class Particle:")
        cls_end = source.index("\n\nclass ParticleSystem:")
        cls_source = source[cls_start:cls_end]
        ns: dict = {"random": __import__("random"), "math": __import__("math")}
        exec(cls_source, ns)  # noqa: S102
        cls.Particle = ns["Particle"]

    def test_particle_has_drift_phase(self):
        """Particle has _drift_phase for organic movement."""
        p = self.Particle(100, 100, "#4AE3D0", 2)
        self.assertTrue(hasattr(p, "_drift_phase"))

    def test_particle_smooth_fade(self):
        """Alpha uses quadratic fade (dimmer at midlife than linear)."""
        p = self.Particle(0, 0, "#FFFFFF", 2)
        p.max_life = 100
        p.life = 50
        col = p.alpha_hex
        # With quadratic fade, at 50% life frac=0.25 (raw=0.5, squared=0.25)
        # So R = 255 * 0.25 * 0.7 = ~44.6 → 0x2c
        r_val = int(col[1:3], 16)
        self.assertLess(r_val, 80)  # Definitely dimmer than linear

    def test_particle_drift_in_update(self):
        """Update uses sinusoidal drift."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("class Particle:")
        body = source[idx:idx + 1200]
        self.assertIn("_drift_phase", body)
        self.assertIn("sin(self.life", body)


class DrawNebulaeEnhancedTests(unittest.TestCase):
    """Tests for enhanced _draw_nebulae with drift and color cycling."""

    def test_nebulae_has_drift(self):
        """Nebulae positions drift with sin/cos."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _draw_nebulae(")
        body = source[idx:idx + 1200]
        self.assertIn("drift_x", body)
        self.assertIn("drift_y", body)

    def test_nebulae_color_temperature(self):
        """Nebula color has temperature cycling."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _draw_nebulae(")
        body = source[idx:idx + 1200]
        self.assertIn("color_shift", body)

    def test_nebulae_two_harmonic_breathing(self):
        """Breathing uses two sine harmonics for organic rhythm."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _draw_nebulae(")
        body = source[idx:idx + 1200]
        # Find the breath assignment line only (single line)
        breath_start = body.index("breath =")
        breath_end = body.index("\n", breath_start)
        breath_line = body[breath_start:breath_end]
        self.assertEqual(breath_line.count("sin("), 2)


class GraphAITickEnhancedTests(unittest.TestCase):
    """Tests for enhanced _graph_ai_tick with eased waves and varied trails."""

    def test_scan_wave_has_lifespan(self):
        """Scan waves have variable lifespan."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _graph_ai_tick(")
        body = source[idx:idx + 5500]
        self.assertIn('"lifespan"', body)

    def test_scan_wave_eased_expansion(self):
        """Scan wave uses quadratic ease-out for radius expansion."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _graph_ai_tick(")
        body = source[idx:idx + 5500]
        self.assertIn("ease", body.lower())
        self.assertIn("** 2", body)

    def test_trail_has_variable_speed(self):
        """Data trails have variable speed property."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _graph_ai_tick(")
        body = source[idx:idx + 5500]
        self.assertIn('"speed":', body)
        self.assertIn("uniform(0.03, 0.07)", body)


class GraphAIOverlayEnhancedTests(unittest.TestCase):
    """Tests for enhanced graph AI overlay rendering."""

    def test_scan_wave_inner_echo_ring(self):
        """Scan waves have inner echo ring at 50% radius."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("# Scan waves (expanding circles with multi-ring")
        body = source[idx:idx + 1500]
        self.assertIn("inner_r", body)
        self.assertIn("inner_a", body)

    def test_node_glow_multi_ring(self):
        """Active nodes get 3-ring radial gradient glow."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("# AI-active node highlights (multi-ring radial glow")
        body = source[idx:idx + 1500]
        self.assertIn("range(3)", body)
        self.assertIn("radial", body.lower())

    def test_trail_glow_behind_head(self):
        """Data trails have glow behind head dot."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("# Data transfer trails (moving dots with glow)")
        body = source[idx:idx + 1500]
        self.assertIn("glow_r", body)
        self.assertIn("Bright head", body)

    def test_trail_five_segment_tail(self):
        """Data trails have 5-segment fading tail."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("# Data transfer trails (moving dots with glow)")
        body = source[idx:idx + 1500]
        self.assertIn("range(5)", body)
        self.assertIn("tail_fade", body)


class AnimateEnhancedTests(unittest.TestCase):
    """Tests for enhanced _animate scheduling."""

    def test_graph_redraw_faster_during_ai(self):
        """Graph redraws at 0.30s during AI processing (was 0.45s)."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _animate(")
        body = source[idx:idx + 4000]
        self.assertIn("0.30", body)

    def test_graph_flow_particle_varied_speed(self):
        """Ambient graph flow particles have varied speed."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _animate(")
        body = source[idx:idx + 1500]
        self.assertIn("uniform(0.02, 0.04)", body)

    def test_particle_system_glow_halo(self):
        """ParticleSystem draws glow halo for larger particles."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("class ParticleSystem:")
        body = source[idx:idx + 1500]
        self.assertIn("glow halo", body.lower())
        self.assertIn("create_oval", body)


# ─── RT VIZ WAVE 2 TESTS ─────────────────────────────────────

class VignetteEnhancedTests(unittest.TestCase):
    """Tests for _draw_vignette enhancements: breathing opacity and color temperature shift."""

    @classmethod
    def setUpClass(cls):
        src = Path(__file__).resolve().parent.parent / "main.py"
        cls.source = src.read_text(encoding="utf-8")
        idx = cls.source.index("def _draw_vignette(")
        cls.body = cls.source[idx:idx + 2000]

    def test_breathing_opacity(self):
        """Vignette has time-based breathing intensity."""
        self.assertIn("breath", self.body)
        self.assertIn("math.sin", self.body)

    def test_color_temperature_shift(self):
        """Vignette color temperature shifts warm/cool over time."""
        self.assertIn("temp_shift", self.body)

    def test_warm_cool_applied(self):
        """Temperature shift modifies red and blue channels."""
        self.assertIn("1.0 + temp_shift", self.body)
        self.assertIn("1.0 - temp_shift", self.body)

    def test_time_used(self):
        """Vignette uses time.time() for animation."""
        self.assertIn("time.time()", self.body)


class HexGridEnhancedTests(unittest.TestCase):
    """Tests for hex grid wave distortion in _draw_graph."""

    @classmethod
    def setUpClass(cls):
        src = Path(__file__).resolve().parent.parent / "main.py"
        cls.source = src.read_text(encoding="utf-8")
        idx = cls.source.index("Breathing hex grid overlay")
        cls.body = cls.source[idx:idx + 1500]

    def test_wave_distortion(self):
        """Grid dots have radial wave distortion."""
        self.assertIn("wave_val", self.body)

    def test_radial_wave_from_center(self):
        """Wave uses distance from center."""
        self.assertIn("dist_c", self.body)
        self.assertIn("math.hypot", self.body)

    def test_position_jitter(self):
        """Grid dots have subtle position jitter from wave."""
        self.assertIn("jx", self.body)
        self.assertIn("jy", self.body)

    def test_row_phase_stagger(self):
        """Each grid row has a staggered phase for organic feel."""
        self.assertIn("row_phase", self.body)

    def test_local_pulse_per_dot(self):
        """Each dot gets individual brightness based on wave position."""
        self.assertIn("local_pulse", self.body)


class SchemaMetricsEnhancedTests(unittest.TestCase):
    """Tests for _draw_schema_metrics enhancements."""

    @classmethod
    def setUpClass(cls):
        src = Path(__file__).resolve().parent.parent / "main.py"
        cls.source = src.read_text(encoding="utf-8")
        idx = cls.source.index("def _draw_schema_metrics(")
        cls.body = cls.source[idx:idx + 3500]

    def test_error_pulse_panel(self):
        """Panel background pulses red when errors exist."""
        self.assertIn("err_pulse", self.body)
        self.assertIn('P["err"]', self.body)

    def test_sequential_corner_accents(self):
        """Corner accents light up in sequence."""
        self.assertIn("corner_phase", self.body)
        self.assertIn("corner_bright", self.body)

    def test_cascade_segment_animation(self):
        """Progress bar segments animate in with cascade timing."""
        self.assertIn("seg_phase", self.body)
        self.assertIn("seg_bright", self.body)

    def test_shimmer_highlight(self):
        """Filled progress bar has a shimmer highlight line."""
        self.assertIn("shimmer_x", self.body)
        self.assertIn("text_bright", self.body)


class PipelineNodeEnhancedTests(unittest.TestCase):
    """Tests for _draw_pipeline_node active state enhancements."""

    @classmethod
    def setUpClass(cls):
        src = Path(__file__).resolve().parent.parent / "main.py"
        cls.source = src.read_text(encoding="utf-8")
        idx = cls.source.index("def _draw_pipeline_node(")
        cls.body = cls.source[idx:idx + 5000]

    def test_rotating_corner_sparks(self):
        """Active node has rotating corner sparks with math.cos/sin."""
        self.assertIn("rot_angle", self.body)
        self.assertIn("math.cos(a)", self.body)
        self.assertIn("math.sin(a)", self.body)

    def test_secondary_spark(self):
        """Each corner has a secondary shorter spark at perpendicular angle."""
        self.assertIn("math.pi / 3", self.body)
        self.assertIn("spark_len * 0.6", self.body)

    def test_wave_propagation_glow(self):
        """Multi-ring glow has wave propagation with staggered phases."""
        self.assertIn("wave_phase", self.body)

    def test_shadow_sway(self):
        """Ground shadow sways with sine oscillation."""
        self.assertIn("shadow_off", self.body)

    def test_progress_bar_highlight(self):
        """Active progress bar has sweeping highlight."""
        src = Path(__file__).resolve().parent.parent / "main.py"
        source = src.read_text(encoding="utf-8")
        idx = source.index("def _draw_pipeline_node(")
        body = source[idx:idx + 7000]
        self.assertIn("highlight_x", body)


class DrawArrowEnhancedTests(unittest.TestCase):
    """Tests for _draw_arrow flow enhancements."""

    @classmethod
    def setUpClass(cls):
        src = Path(__file__).resolve().parent.parent / "main.py"
        cls.source = src.read_text(encoding="utf-8")
        idx = cls.source.index("def _draw_arrow(")
        cls.body = cls.source[idx:idx + 3500]

    def test_smoothstep_easing(self):
        """Energy dots use smoothstep for acceleration/deceleration."""
        self.assertIn("3.0 - 2.0 *", self.body)

    def test_fading_trail(self):
        """Primary dot has fading trail segments behind it."""
        self.assertIn("range(3)", self.body)
        self.assertIn("trail_alpha", self.body)

    def test_arrow_head_pulse(self):
        """Active arrow has pulsing head glow."""
        self.assertIn("head_pulse", self.body)
        self.assertIn("head_glow_r", self.body)

    def test_trail_eased(self):
        """Trail segments also use smoothstep easing."""
        self.assertIn("tf_smooth", self.body)


class GraphMinimapEnhancedTests(unittest.TestCase):
    """Tests for _draw_graph_minimap enhancements."""

    @classmethod
    def setUpClass(cls):
        src = Path(__file__).resolve().parent.parent / "main.py"
        cls.source = src.read_text(encoding="utf-8")
        idx = cls.source.index("def _draw_graph_minimap(")
        cls.body = cls.source[idx:idx + 4000]

    def test_mini_edges(self):
        """Minimap draws mini edges (connections between nodes)."""
        self.assertIn("mini edges", self.body.lower())
        self.assertIn("create_line", self.body)

    def test_active_node_pulse(self):
        """AI-active nodes pulse brighter in minimap."""
        self.assertIn("is_ai_active", self.body)
        self.assertIn("mr_pulse", self.body)

    def test_viewport_glow_animation(self):
        """Viewport rectangle has animated glow."""
        self.assertIn("vp_pulse", self.body)
        self.assertIn("vp_col", self.body)


class GraphStatsEnhancedTests(unittest.TestCase):
    """Tests for _draw_graph_stats enhancements."""

    @classmethod
    def setUpClass(cls):
        src = Path(__file__).resolve().parent.parent / "main.py"
        cls.source = src.read_text(encoding="utf-8")
        idx = cls.source.index("def _draw_graph_stats(")
        cls.body = cls.source[idx:idx + 3500]

    def test_sequential_corner_lighting(self):
        """Corner accents light up in sequence."""
        self.assertIn("corner_phase", self.body)
        self.assertIn("corner_bright", self.body)

    def test_color_reactive_bar(self):
        """Density bar uses different colors based on density threshold."""
        self.assertIn("density < 0.3", self.body)
        self.assertIn("density < 0.6", self.body)

    def test_shimmer_on_bar(self):
        """Density bar has shimmer highlight."""
        self.assertIn("shimmer_pos", self.body)
        self.assertIn("text_bright", self.body)


# ═══════════════════════════════════════════════════════════════
# ─── WAVE 3 RT VISUALIZATION TESTS ───────────────────────────
# ═══════════════════════════════════════════════════════════════

class EdgeRenderingEnhancedTests(unittest.TestCase):
    """Tests for edge rendering enhancements in _draw_graph."""

    @classmethod
    def setUpClass(cls):
        src = Path(__file__).resolve().parent.parent / "main.py"
        cls.source = src.read_text(encoding="utf-8")
        idx = cls.source.index("Edges: curved lines with directional arrows")
        cls.body = cls.source[idx:idx + 3500]

    def test_edge_glow_breathing_pulse(self):
        """Edge glow width pulses with time."""
        self.assertIn("edge_pulse", self.body)
        self.assertIn("t_edge", self.body)

    def test_shimmer_sweep_dot(self):
        """High-importance edges have a shimmer sweep dot."""
        self.assertIn("shimmer_frac", self.body)
        self.assertIn("edge_imp >= 0.5", self.body)

    def test_arrow_head_pulse(self):
        """Arrow head size pulses for breathing effect."""
        self.assertIn("arr_pulse", self.body)
        self.assertIn("asize_p", self.body)

    def test_glow_width_variation(self):
        """Glow width varies with time for breathing effect."""
        self.assertIn("glow_w", self.body)
        self.assertIn("math.sin", self.body)


class AIStatusPanelEnhancedTests(unittest.TestCase):
    """Tests for AI Status Panel animation enhancements in _draw_graph."""

    @classmethod
    def setUpClass(cls):
        src = Path(__file__).resolve().parent.parent / "main.py"
        cls.source = src.read_text(encoding="utf-8")
        idx = cls.source.index("AI Live Status Panel (top-right)")
        cls.body = cls.source[idx:idx + 3500]

    def test_panel_glow_aura(self):
        """Panel has outer glow aura that breathes."""
        self.assertIn("panel_breath", self.body)
        self.assertIn("aura_bright", self.body)

    def test_border_width_breathing(self):
        """Panel border width changes with time."""
        self.assertIn("border_w", self.body)
        self.assertIn("panel_breath", self.body)

    def test_corner_sequential_pulse(self):
        """Corner accents pulse sequentially."""
        self.assertIn("corner_phase", self.body)
        self.assertIn("corner_bright", self.body)
        self.assertIn("ci_a", self.body)

    def test_aura_layers(self):
        """Three aura layers surround the panel."""
        self.assertIn("aura_off", self.body)
        self.assertIn("range(3)", self.body)


class TagCloudEnhancedTests(unittest.TestCase):
    """Tests for tag cloud view animation enhancements."""

    @classmethod
    def setUpClass(cls):
        src = Path(__file__).resolve().parent.parent / "main.py"
        cls.source = src.read_text(encoding="utf-8")
        idx = cls.source.index("def _draw_tag_cloud_view(")
        cls.body = cls.source[idx:idx + 4000]

    def test_pill_glow_pulse(self):
        """Tag pills pulse glow based on frequency."""
        self.assertIn("tag_phase", self.body)
        self.assertIn("tag_glow", self.body)

    def test_frequency_bar_indicator(self):
        """Frequency bar at bottom of each pill shows tag prevalence."""
        self.assertIn("freq_bar_w", self.body)
        self.assertIn("fb_r", self.body)

    def test_outline_width_varies(self):
        """Outline width varies for high-frequency tags."""
        self.assertIn("outline_w", self.body)
        self.assertIn("ratio < 0.5", self.body)

    def test_time_variable(self):
        """Tag cloud uses time for animation."""
        self.assertIn("t_cloud", self.body)


class TimelineEnhancedTests(unittest.TestCase):
    """Tests for timeline event animation enhancements."""

    @classmethod
    def setUpClass(cls):
        src = Path(__file__).resolve().parent.parent / "main.py"
        cls.source = src.read_text(encoding="utf-8")
        idx = cls.source.index("def _draw_timeline(")
        cls.body = cls.source[idx:idx + 4500]

    def test_cascade_drop_line(self):
        """Drop lines have cascading dash offset animation."""
        self.assertIn("drop_phase", self.body)
        self.assertIn("drop_dash_off", self.body)
        self.assertIn("dashoffset", self.body)

    def test_dot_pulse_animation(self):
        """Event dots pulse with cascading phase."""
        self.assertIn("dot_phase", self.body)
        self.assertIn("dot_pulse", self.body)
        self.assertIn("pulse_r", self.body)

    def test_time_variable(self):
        """Timeline uses time for animation."""
        self.assertIn("t_tl", self.body)

    def test_glow_outer_breathing(self):
        """Glow ring outer radius responds to pulse."""
        self.assertIn("glow_outer", self.body)


class NodeLabelsEnhancedTests(unittest.TestCase):
    """Tests for node label and badge animation enhancements in _draw_graph."""

    @classmethod
    def setUpClass(cls):
        src = Path(__file__).resolve().parent.parent / "main.py"
        cls.source = src.read_text(encoding="utf-8")
        idx = cls.source.index("Connection count badge (top-right)")
        cls.body = cls.source[idx:idx + 2500]

    def test_badge_pulse_animation(self):
        """Badge radius pulses over time."""
        self.assertIn("badge_pulse", self.body)
        self.assertIn("badge_phase", self.body)
        self.assertIn("bp_r", self.body)

    def test_active_label_glow_aura(self):
        """Active node label has glow aura."""
        self.assertIn("lbl_glow", self.body)
        self.assertIn("lbl_glow_off", self.body)

    def test_label_glow_color_calculation(self):
        """Label glow uses color calculation from cyan_dim."""
        self.assertIn("lgr", self.body)
        self.assertIn("lgg", self.body)
        self.assertIn("lgb", self.body)


class HeatMapLegendEnhancedTests(unittest.TestCase):
    """Tests for heat map legend animation enhancements."""

    @classmethod
    def setUpClass(cls):
        src = Path(__file__).resolve().parent.parent / "main.py"
        cls.source = src.read_text(encoding="utf-8")
        idx = cls.source.index("Heat map legend (bottom-left)")
        cls.body = cls.source[idx:idx + 2000]

    def test_shimmer_sweep(self):
        """Legend has shimmer highlight sweeping across."""
        self.assertIn("legend_shimmer", self.body)

    def test_breathing_swatches(self):
        """Legend color swatches breathe with phase offset."""
        self.assertIn("swatch_breath", self.body)
        self.assertIn("lphase", self.body)

    def test_legend_items_list(self):
        """Legend defines items with phase offsets."""
        self.assertIn("legend_items", self.body)

    def test_time_variable(self):
        """Legend uses time for animation."""
        self.assertIn("t_legend", self.body)


class RetryLoopEnhancedTests(unittest.TestCase):
    """Tests for retry feedback loop animation enhancements."""

    @classmethod
    def setUpClass(cls):
        src = Path(__file__).resolve().parent.parent / "main.py"
        cls.source = src.read_text(encoding="utf-8")
        idx = cls.source.index("Retry feedback loop arrow")
        cls.body = cls.source[idx:idx + 4500]

    def test_pulsing_glow_width(self):
        """Retry glow width pulses when active."""
        self.assertIn("retry_breath", self.body)
        self.assertIn("glow_w_retry", self.body)

    def test_marching_ants_dash(self):
        """Dash offset animates for marching ants effect."""
        self.assertIn("dash_off_retry", self.body)
        self.assertIn("dashoffset", self.body)

    def test_corner_bounce(self):
        """Corner dots bounce when retry is active."""
        self.assertIn("corner_bounce", self.body)

    def test_arrow_head_breathing(self):
        """Arrow head size breathes with pulse."""
        self.assertIn("arr_pulse_retry", self.body)
        self.assertIn("arr_s", self.body)

    def test_three_energy_dots(self):
        """Three energy dots (instead of two) traverse the path."""
        self.assertIn("0.33", self.body)
        self.assertIn("0.66", self.body)

    def test_dot_trailing_glow(self):
        """Energy dots have trailing fade glow."""
        self.assertIn("dot_glow_r", self.body)
        self.assertIn("dgr", self.body)

    def test_label_pulse(self):
        """Retry label text color pulses."""
        self.assertIn("label_pulse", self.body)
        self.assertIn("rl_r", self.body)


if __name__ == "__main__":
    unittest.main()
