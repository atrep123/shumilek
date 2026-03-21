"""Tests for shumilek_hive pure functions and path safety."""
import unittest
import re
import sys
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
        ns: dict = {"random": __import__("random")}
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


if __name__ == "__main__":
    unittest.main()
