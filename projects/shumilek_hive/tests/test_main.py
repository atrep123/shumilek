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


if __name__ == "__main__":
    unittest.main()
