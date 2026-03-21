"""
Shumilek Hive — Living AI Knowledge Hub
A dark pixel art information organism where AI works, you watch, and assign tasks.
Inspired by Obsidian + Stardew Valley dark mine aesthetic.
"""
import tkinter as tk
from tkinter import messagebox, simpledialog, filedialog
import re
import math
import random
import time
import datetime
import json
import traceback
from pathlib import Path
from collections import defaultdict

# Optional: PIL for pixel art assets (graceful fallback to text if not installed)
try:
    from PIL import Image, ImageTk
    _HAS_PIL = True
except ImportError:
    _HAS_PIL = False

# ─── ASSET LOADING ──────────────────────────────────────────────────
_ASSET_DIR = Path(__file__).parent / "assets" / "pixelart"
_loaded_images: dict[str, "ImageTk.PhotoImage"] = {}  # keep references to prevent GC


def _load_icon(name: str, size: tuple[int, int] = (20, 20)) -> "ImageTk.PhotoImage | None":
    """Load a pixel art icon from assets/pixelart, resized with nearest-neighbor."""
    if not _HAS_PIL:
        return None
    if name in _loaded_images:
        return _loaded_images[name]
    path = _ASSET_DIR / f"{name}.png"
    if not path.exists():
        return None
    img = None
    try:
        img = Image.open(path).convert("RGBA")
        img = img.resize(size, Image.NEAREST)
        photo = ImageTk.PhotoImage(img)
        _loaded_images[name] = photo
        return photo
    except (OSError, ValueError) as e:
        print(f"[WARN] Failed to load icon {name}: {e}")
        return None
    finally:
        if img is not None:
            img.close()

# ─── COLOR PALETTE (Stardew dark mines — NO yellow) ──────────────────
P = {
    "void":       "#080610",
    "obsidian":   "#0E0B18",
    "panel":      "#161224",
    "panel_alt":  "#1C1730",
    "surface":    "#221D38",
    "hover":      "#2D2650",

    "cyan":       "#4AE3D0",
    "cyan_dim":   "#2A9D8F",
    "teal":       "#20B2AA",
    "amethyst":   "#A86ED6",
    "amethyst_dim":"#6B4A8A",
    "rose":       "#E06080",
    "rose_dim":   "#8A3A4E",
    "emerald":    "#30D080",
    "ember":      "#D4764E",
    "ice":        "#7EC8E3",

    "text":       "#B8A8D8",
    "text_dim":   "#6A5E8A",
    "text_bright":"#DDD0F0",
    "heading":    "#C0A0F0",
    "link":       "#4AE3D0",
    "tag":        "#A86ED6",
    "code_fg":    "#D4764E",

    "border":     "#2A2245",
    "border_glow":"#4A3F7A",
    "separator":  "#1E1835",

    "ok":         "#30D080",
    "warn":       "#D4764E",
    "err":        "#E06080",

    "node_context":  "#20B2AA",
    "node_rozum":    "#7EC8E3",
    "node_generate": "#A86ED6",
    "node_guardian":"#30D080",
    "node_halluc":   "#D4764E",
    "node_svedomi":  "#4AE3D0",
    "node_retry":    "#E06080",
    "node_output":   "#C0A0F0",

    "particle1":  "#4AE3D044",
    "particle2":  "#A86ED644",
    "particle3":  "#30D08044",
}

FONT = "Consolas"
F_MONO = (FONT, 11)
F_SMALL = (FONT, 9)
F_TITLE = (FONT, 14, "bold")
F_HEAD = (FONT, 12, "bold")
F_BIG = (FONT, 18, "bold")
F_PIXEL = (FONT, 8)

# ─── PRE-COMPILED REGEX ──────────────────────────────────────────────
_RE_WIKILINK = re.compile(r'\[\[([^\]]+)\]\]')
_RE_HEADING = re.compile(r'^#{1,3}\s', re.MULTILINE)
_RE_TAG = re.compile(r'(?<!\w)#(\w[\w-]*)')
_RE_TAG_BARE = re.compile(r'#(\w[\w-]*)')
_RE_HR = re.compile(r'^-{3,}$')
_RE_TASK_DONE = re.compile(r'^\s*- \[x\]\s')
_RE_TASK_OPEN = re.compile(r'^\s*- \[ \]\s')
_RE_BULLET = re.compile(r'^(\s*)([-*])')
_RE_BULLET_LINE = re.compile(r'^\s*[-*]\s')
_RE_TABLE_SEP = re.compile(r'^\|[-| ]+\|$')
_RE_TABLE_ROW = re.compile(r'^\|.*\|$')
_RE_CODE_SPAN = re.compile(r'`([^`]+)`')
_RE_BOLD = re.compile(r'\*\*([^*]+)\*\*')
_RE_HEADING_PREFIX = re.compile(r'^#{1,3}\s')
_RE_PREVIEW_SPLIT = re.compile(r'(\*\*[^*]+\*\*|`[^`]+`|\[\[[^\]]+\]\]|#\w[\w-]*)')

# ─── STOP WORDS (EN + CZ) ───────────────────────────────────────────
_STOP_WORDS: frozenset[str] = frozenset({
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "need", "must", "ought",
    "and", "but", "or", "nor", "not", "so", "yet", "for", "to", "of",
    "in", "on", "at", "by", "with", "from", "up", "out", "if", "then",
    "than", "too", "very", "just", "about", "above", "after", "again",
    "all", "also", "am", "any", "as", "back", "because", "before",
    "between", "both", "come", "each", "even", "first", "get", "give",
    "go", "good", "he", "her", "here", "him", "his", "how", "i", "into",
    "it", "its", "know", "last", "like", "look", "make", "me", "more",
    "most", "my", "new", "no", "now", "off", "old", "one", "only", "other",
    "our", "over", "own", "say", "she", "some", "still", "take", "tell",
    "that", "their", "them", "these", "they", "thing", "think", "this",
    "those", "through", "time", "two", "us", "use", "want", "way", "we",
    "well", "what", "when", "where", "which", "while", "who", "why",
    "work", "year", "you", "your", "se", "je", "na", "za", "ve", "do",
    "od", "po", "pro", "pri", "jak", "ale", "nebo", "tak", "ten", "ta",
    "to", "ty", "jsou", "byl", "bylo", "bude", "jsem", "jsi", "jsme",
    "jste", "mam", "mas", "ma", "mame", "mate", "maji",
})


# ─── PARTICLE SYSTEM ────────────────────────────────────────────────
class Particle:
    __slots__ = ("x", "y", "vx", "vy", "life", "max_life", "color", "size")
    def __init__(self, x, y, color, size=2):
        self.x = x
        self.y = y
        self.vx = random.uniform(-0.3, 0.3)
        self.vy = random.uniform(-0.8, -0.15)
        self.life = 0
        self.max_life = random.randint(40, 120)
        self.color = color
        self.size = size

    def update(self) -> bool:
        self.x += self.vx
        self.y += self.vy
        self.vx += random.uniform(-0.05, 0.05)
        self.life += 1
        return self.life < self.max_life

    @property
    def alpha_hex(self) -> str:
        frac = 1.0 - self.life / self.max_life
        base = self.color.lstrip("#")
        r, g, b = int(base[:2], 16), int(base[2:4], 16), int(base[4:6], 16)
        r = int(r * frac * 0.6)
        g = int(g * frac * 0.6)
        b = int(b * frac * 0.6)
        return f"#{r:02x}{g:02x}{b:02x}"


class ParticleSystem:
    def __init__(self, max_particles=35):
        self.particles: list[Particle] = []
        self.max_particles = max_particles
        self._colors = [P["cyan"], P["amethyst"], P["emerald"], P["ice"], P["rose"]]

    def emit(self, x, y, count=1):
        for _ in range(count):
            if len(self.particles) < self.max_particles:
                c = random.choice(self._colors)
                s = random.choice([2, 2, 3, 3, 4])
                self.particles.append(Particle(x, y, c, s))

    def update(self):
        self.particles = [p for p in self.particles if p.update()]

    def draw(self, canvas: tk.Canvas):
        for p in self.particles:
            try:
                col = p.alpha_hex
                canvas.create_rectangle(
                    p.x, p.y, p.x + p.size, p.y + p.size,
                    fill=col, outline="", tags="particle")
            except (ValueError, tk.TclError):
                pass


# ─── FLOW PARTICLES (travel along pipeline arrows) ──────────────────
class FlowParticle:
    """A particle that travels along a line from src to dst."""
    __slots__ = ("sx", "sy", "ex", "ey", "t", "speed", "color", "size", "trail")
    def __init__(self, sx, sy, ex, ey, color, speed=0.025):
        self.sx, self.sy = sx, sy
        self.ex, self.ey = ex, ey
        self.t = 0.0
        self.speed = speed + random.uniform(-0.005, 0.005)
        self.color = color
        self.size = random.choice([2, 2, 3])
        self.trail: list[tuple[float, float]] = []

    def update(self) -> bool:
        self.trail.append((self.sx + (self.ex - self.sx) * self.t,
                           self.sy + (self.ey - self.sy) * self.t))
        if len(self.trail) > 12:
            self.trail.pop(0)
        self.t += self.speed
        return self.t < 1.0

    @property
    def x(self):
        return self.sx + (self.ex - self.sx) * self.t

    @property
    def y(self):
        return self.sy + (self.ey - self.sy) * self.t

    def draw(self, canvas: tk.Canvas):
        # Trail (fading dots — growing toward head)
        base = self.color.lstrip("#")
        r0, g0, b0 = int(base[:2], 16), int(base[2:4], 16), int(base[4:6], 16)
        n = len(self.trail)
        for i, (tx, ty) in enumerate(self.trail):
            frac = (i + 1) / (n + 1) * 0.5
            cr = int(r0 * frac)
            cg = int(g0 * frac)
            cb = int(b0 * frac)
            ts = 1 + i * 2 // max(n, 1)  # trail dots grow toward head
            canvas.create_rectangle(tx - ts, ty - ts, tx + ts, ty + ts,
                                    fill=f"#{cr:02x}{cg:02x}{cb:02x}", outline="", tags="flow")
        # Head glow halo
        gs = self.size + 3
        gr = int(r0 * 0.25)
        gg = int(g0 * 0.25)
        gb = int(b0 * 0.25)
        canvas.create_oval(self.x - gs, self.y - gs, self.x + gs, self.y + gs,
                           fill=f"#{gr:02x}{gg:02x}{gb:02x}", outline="", tags="flow")
        # Head (bright dot)
        canvas.create_oval(self.x - self.size, self.y - self.size,
                           self.x + self.size, self.y + self.size,
                           fill=self.color, outline="", tags="flow")

    def draw_on(self, canvas: tk.Canvas, tag: str):
        """Draw with a custom tag (for graph vs schema)."""
        base = self.color.lstrip("#")
        r0, g0, b0 = int(base[:2], 16), int(base[2:4], 16), int(base[4:6], 16)
        n = len(self.trail)
        for i, (tx, ty) in enumerate(self.trail):
            frac = (i + 1) / (n + 1) * 0.5
            cr = int(r0 * frac)
            cg = int(g0 * frac)
            cb = int(b0 * frac)
            ts = 1 + i * 2 // max(n, 1)
            canvas.create_rectangle(tx - ts, ty - ts, tx + ts, ty + ts,
                                    fill=f"#{cr:02x}{cg:02x}{cb:02x}", outline="", tags=tag)
        # Head glow halo
        gs = self.size + 3
        gr = int(r0 * 0.25)
        gg = int(g0 * 0.25)
        gb = int(b0 * 0.25)
        canvas.create_oval(self.x - gs, self.y - gs, self.x + gs, self.y + gs,
                           fill=f"#{gr:02x}{gg:02x}{gb:02x}", outline="", tags=tag)
        canvas.create_oval(self.x - self.size, self.y - self.size,
                           self.x + self.size, self.y + self.size,
                           fill=self.color, outline="", tags=tag)


class StarField:
    """Twinkling pixel star background with micro-jitter."""
    _BRIGHT_STEPS = 8  # pre-computed brightness levels per color

    def __init__(self, count=80):
        # Stars now store (x, y, phase, color, jitter_phase)
        self.stars: list[tuple[float, float, float, str, float]] = []
        colors = [P["text_dim"], P["amethyst_dim"], P["cyan_dim"], P["ice"]]
        # Pre-compute color lookup: color → [hex at brightness 0..7]
        self._color_lut: dict[str, list[str]] = {}
        for color in colors:
            base = color.lstrip("#")
            rb, gb, bb = int(base[:2], 16), int(base[2:4], 16), int(base[4:6], 16)
            lut: list[str] = []
            for si in range(self._BRIGHT_STEPS):
                br = 0.3 + 0.7 * si / (self._BRIGHT_STEPS - 1)
                rv = max(0, min(255, int(rb * br)))
                gv = max(0, min(255, int(gb * br)))
                bv = max(0, min(255, int(bb * br)))
                lut.append(f"#{rv:02x}{gv:02x}{bv:02x}")
            self._color_lut[color] = lut
        for _ in range(count):
            x = random.random()
            y = random.random()
            phase = random.uniform(0, math.pi * 2)
            color = random.choice(colors)
            jitter_phase = random.uniform(0, math.pi * 2)
            self.stars.append((x, y, phase, color, jitter_phase))

    def draw(self, canvas: tk.Canvas, w: int, h: int, t: float):
        steps_m1 = self._BRIGHT_STEPS - 1
        for sx, sy, phase, color, jp in self.stars:
            brightness = 0.3 + 0.7 * abs(math.sin(t * 0.8 + phase))
            if brightness < 0.35:
                continue
            # Micro-jitter: stars wobble ±1px for organic feel
            jx = math.sin(t * 1.2 + jp) * 1.2
            jy = math.cos(t * 0.9 + jp * 1.7) * 1.2
            px = int(sx * w + jx)
            py = int(sy * h + jy)
            idx = min(steps_m1, int((brightness - 0.3) / 0.7 * steps_m1))
            col = self._color_lut[color][idx]
            size = 1 if brightness < 0.6 else 2
            canvas.create_rectangle(px, py, px + size, py + size,
                                    fill=col, outline="", tags="stars")
            # Cross sparkle on brightest stars
            if brightness > 0.85 and size >= 2:
                canvas.create_line(px - 3, py, px + 4, py, fill=col, width=1, tags="stars")
                canvas.create_line(px, py - 3, px + 1, py + 4, fill=col, width=1, tags="stars")


# ─── PIPELINE SIMULATION ────────────────────────────────────────────
class PipelineSimulator:
    """Simulates the Shumilek AI pipeline for visualization."""

    NODES = [
        ("context",  "Context\nGathering",   "node_context",  "WorkspaceIndexer + ContextProviders"),
        ("routing",  "Input\nRouting",        "node_context",  "Validate + ModelRouter"),
        ("rozum",    "Rozum\nPlanning",       "node_rozum",    "deepseek-r1:8b → RozumPlan"),
        ("generate", "Response\nGeneration",  "node_generate", "Main model + Tool execution"),
        ("guardian", "Guardian\nAnalysis",     "node_guardian", "Loop/repetition/truncation detect"),
        ("halluc",   "Hallucination\nDetector","node_halluc",  "URL/fact/context patterns"),
        ("svedomi",  "Svedomi\nValidator",    "node_svedomi",  "qwen2.5:3b → SKORE 1-10"),
        ("decision", "Retry\nDecision",       "node_retry",    "Pass/Retry/Accept with feedback"),
        ("output",   "Final\nOutput",         "node_output",   "Post-process + deliver"),
    ]

    def __init__(self):
        self.active_node = 0
        self.node_states: dict[str, str] = {}  # idle|active|done|error|retry
        self.metrics: dict[str, str] = {}
        self.retry_count = 0
        self.max_retries = 3
        self.is_running = False
        self.tick = 0
        self.scenario_step = 0
        self._scenario: list[dict] = []
        self.event_log: list[str] = []
        self.elapsed_time = 0.0
        self.reset()

    def reset(self):
        for node_id, _, _, _ in self.NODES:
            self.node_states[node_id] = "idle"
        self.metrics = {}
        self.active_node = -1
        self.retry_count = 0
        self.scenario_step = 0
        self.event_log = ["[system] pipeline reset — awaiting scenario"]
        self.elapsed_time = 0.0

    def start_scenario(self, scenario_name="default"):
        self.reset()
        self.is_running = True
        self.tick = 0
        self.event_log = [f"[start] scenario '{scenario_name}' initiated"]
        if scenario_name == "success":
            self._scenario = [
                {"node": "context",  "duration": 8,  "result": "done", "metric": "5 providers, 2.1k tokens"},
                {"node": "routing",  "duration": 4,  "result": "done", "metric": "complex query → plan"},
                {"node": "rozum",    "duration": 15, "result": "done", "metric": "7 steps, complexity=high"},
                {"node": "generate", "duration": 20, "result": "done", "metric": "1847 tokens, 3 tools"},
                {"node": "guardian", "duration": 6,  "result": "done", "metric": "isOk=true, score=92%"},
                {"node": "halluc",   "duration": 5,  "result": "done", "metric": "confidence=0.05 ✓"},
                {"node": "svedomi",  "duration": 8,  "result": "done", "metric": "SKORE=8, VALIDNI=ANO"},
                {"node": "decision", "duration": 3,  "result": "done", "metric": "PASS → no retry needed"},
                {"node": "output",   "duration": 4,  "result": "done", "metric": "delivered in 3.2s"},
            ]
        elif scenario_name == "retry":
            self._scenario = [
                {"node": "context",  "duration": 6,  "result": "done", "metric": "3 providers, 1.5k tokens"},
                {"node": "routing",  "duration": 3,  "result": "done", "metric": "direct → no plan"},
                {"node": "rozum",    "duration": 2,  "result": "done", "metric": "skipped (simple query)"},
                {"node": "generate", "duration": 12, "result": "done", "metric": "420 tokens generated"},
                {"node": "guardian", "duration": 5,  "result": "done", "metric": "repetition=45% ⚠"},
                {"node": "halluc",   "duration": 4,  "result": "done", "metric": "confidence=0.3"},
                {"node": "svedomi",  "duration": 7,  "result": "error","metric": "SKORE=3, VALIDNI=NE"},
                {"node": "decision", "duration": 3,  "result": "retry","metric": "RETRY #1 → feedback injected"},
                # Retry loop
                {"node": "generate", "duration": 15, "result": "done", "metric": "892 tokens (retry)"},
                {"node": "guardian", "duration": 5,  "result": "done", "metric": "isOk=true, score=88%"},
                {"node": "halluc",   "duration": 4,  "result": "done", "metric": "confidence=0.08 ✓"},
                {"node": "svedomi",  "duration": 8,  "result": "done", "metric": "SKORE=7, VALIDNI=ANO"},
                {"node": "decision", "duration": 3,  "result": "done", "metric": "PASS after 1 retry"},
                {"node": "output",   "duration": 4,  "result": "done", "metric": "delivered in 5.1s"},
            ]
        elif scenario_name == "hallucination":
            self._scenario = [
                {"node": "context",  "duration": 7,  "result": "done",  "metric": "4 providers, 3k tokens"},
                {"node": "routing",  "duration": 3,  "result": "done",  "metric": "factual question"},
                {"node": "rozum",    "duration": 2,  "result": "done",  "metric": "skipped"},
                {"node": "generate", "duration": 10, "result": "done",  "metric": "512 tokens"},
                {"node": "guardian", "duration": 5,  "result": "done",  "metric": "isOk=true"},
                {"node": "halluc",   "duration": 6,  "result": "error", "metric": "confidence=0.72 ✗ URL invented"},
                {"node": "svedomi",  "duration": 7,  "result": "error", "metric": "SKORE=2, VALIDNI=NE"},
                {"node": "decision", "duration": 3,  "result": "retry", "metric": "RETRY #1 → halluc feedback"},
                {"node": "generate", "duration": 14, "result": "done",  "metric": "680 tokens (fixed)"},
                {"node": "guardian", "duration": 5,  "result": "done",  "metric": "isOk=true"},
                {"node": "halluc",   "duration": 5,  "result": "done",  "metric": "confidence=0.1 ✓"},
                {"node": "svedomi",  "duration": 7,  "result": "done",  "metric": "SKORE=8, VALIDNI=ANO"},
                {"node": "decision", "duration": 3,  "result": "done",  "metric": "PASS after 1 retry"},
                {"node": "output",   "duration": 4,  "result": "done",  "metric": "delivered in 4.8s"},
            ]
        else:  # default continuous demo
            self._scenario = [
                {"node": "context",  "duration": 8, "result": "done", "metric": "workspace scanned"},
                {"node": "routing",  "duration": 4, "result": "done", "metric": "model ready"},
                {"node": "rozum",    "duration": 12,"result": "done", "metric": "5 steps planned"},
                {"node": "generate", "duration": 18,"result": "done", "metric": "generating..."},
                {"node": "guardian", "duration": 6, "result": "done", "metric": "quality OK"},
                {"node": "halluc",   "duration": 5, "result": "done", "metric": "no hallucination"},
                {"node": "svedomi",  "duration": 8, "result": "done", "metric": "SKORE=7"},
                {"node": "decision", "duration": 3, "result": "done", "metric": "PASS"},
                {"node": "output",   "duration": 5, "result": "done", "metric": "complete"},
            ]

    def step(self) -> bool:
        """Advance simulation by one tick. Returns True if still running."""
        if not self.is_running or self.scenario_step >= len(self._scenario):
            if self.is_running:
                self.event_log.append(f"[done] pipeline finished in {self.elapsed_time:.1f}s")
            self.is_running = False
            return False

        self.tick += 1
        self.elapsed_time += 0.12
        current = self._scenario[self.scenario_step]
        node_id = current["node"]

        # Mark active
        if self.node_states[node_id] != "active":
            for nid, _, _, _ in self.NODES:
                if self.node_states[nid] == "active":
                    pass
            self.node_states[node_id] = "active"
            self.metrics[node_id] = current["metric"]
            # Find label for log
            node_label = node_id
            for nid, lbl, _, _ in self.NODES:
                if nid == node_id:
                    node_label = lbl.replace("\n", " ")
                    break
            self.event_log.append(f"[{self.elapsed_time:.1f}s] >> {node_label} — processing...")
            if len(self.event_log) > 200:
                self.event_log = self.event_log[-200:]

        # Check if duration elapsed
        if self.tick >= current["duration"]:
            self.node_states[node_id] = current["result"]
            self.metrics[node_id] = current["metric"]
            result_icon = {"done": "OK", "error": "FAIL", "retry": "RETRY"}.get(current["result"], "?")
            self.event_log.append(f"[{self.elapsed_time:.1f}s]    {result_icon}: {current['metric']}")
            self.scenario_step += 1
            self.tick = 0

            if current["result"] == "retry":
                self.retry_count += 1
                self.event_log.append(f"[{self.elapsed_time:.1f}s] !! RETRY #{self.retry_count} — injecting feedback")
                for nid in ("generate", "guardian", "halluc", "svedomi", "decision"):
                    if self.scenario_step < len(self._scenario):
                        next_node = self._scenario[self.scenario_step]["node"]
                        if nid != next_node:
                            self.node_states[nid] = "idle"

        return True


# ═══════════════════════════════════════════════════════════════════
#   MAIN APPLICATION
# ═══════════════════════════════════════════════════════════════════
def _is_safe_note_name(name: str) -> bool:
    """Return True if *name* is a safe single-component filename (no traversal)."""
    if not name or not name.strip():
        return False
    if ".." in name or "/" in name or "\\" in name:
        return False
    # After stripping, must remain a simple filename (no path components)
    if Path(name).name != name:
        return False
    return True


def _safe_stat(p: Path, attr: str, default=0):
    """Get a stat attribute safely, returning default on OSError."""
    try:
        return getattr(p.stat(), attr)
    except OSError:
        return default


def _hex_color_scale(hex_color: str, factor: float) -> str:
    """Scale a hex color (#RRGGBB) by factor, clamping to 0-255."""
    h = hex_color.lstrip("#")
    r = max(0, min(255, int(int(h[:2], 16) * factor)))
    g = max(0, min(255, int(int(h[2:4], 16) * factor)))
    b = max(0, min(255, int(int(h[4:6], 16) * factor)))
    return f"#{r:02x}{g:02x}{b:02x}"


def _draw_nebulae(c, w: int, h: int, nebulae: list, rings: int, opacity: float, t: float):
    """Draw nebula clouds on canvas. Shared by hive/graph/schema views."""
    for neb in nebulae:
        nx = int(neb["x"] * w)
        ny = int(neb["y"] * h)
        nr = neb["r"]
        breath = 0.5 + 0.5 * abs(math.sin(t * 0.3 + neb["phase"]))
        ncol = neb["color"].lstrip("#")
        for ri in range(rings):
            frac = 1.0 - ri / rings
            cr = int(nr * frac * (0.8 + 0.2 * breath))
            if cr < 1:
                continue
            scale = opacity * frac * breath
            br = max(0, min(255, int(int(ncol[:2], 16) * scale)))
            bg = max(0, min(255, int(int(ncol[2:4], 16) * scale)))
            bb = max(0, min(255, int(int(ncol[4:6], 16) * scale)))
            c.create_oval(nx - cr, ny - cr, nx + cr, ny + cr,
                         fill=f"#{br:02x}{bg:02x}{bb:02x}", outline="")


def _draw_vignette(c, w: int, h: int, size: int = 30):
    """Draw top+bottom vignette overlay on canvas."""
    for vi in range(size):
        frac = 1.0 - vi / size
        vr = max(0, min(255, int(8 * frac)))
        vgc = max(0, min(255, int(6 * frac)))
        vb = max(0, min(255, int(16 * frac)))
        if vr + vgc + vb > 0:
            col = f"#{vr:02x}{vgc:02x}{vb:02x}"
            c.create_line(0, vi, w, vi, fill=col, width=1)
    for vi in range(size):
        frac = vi / size
        vr = max(0, min(255, int(8 * frac)))
        vgc = max(0, min(255, int(6 * frac)))
        vb = max(0, min(255, int(16 * frac)))
        if vr + vgc + vb > 0:
            col = f"#{vr:02x}{vgc:02x}{vb:02x}"
            c.create_line(0, h - size + vi, w, h - size + vi, fill=col, width=1)


class ShumilekHive:
    """Living AI knowledge hub with pipeline visualization and task management."""

    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("Shumilek Hive — Living AI Hub")
        self.root.geometry("1440x920")
        self.root.minsize(1100, 700)
        self.root.configure(bg=P["obsidian"])

        # State
        self.vault_path = Path(__file__).parent / "vault"
        self.vault_path.mkdir(exist_ok=True)
        self.current_file: Path | None = None
        self.modified = False
        self.notes_graph: dict[str, set[str]] = defaultdict(set)
        self.view_mode = "editor"  # editor | graph | schema | preview
        self.search_visible = False
        self._autosave_id = None
        self._all_files: list[Path] = []
        self._graph_node_positions: dict = {}
        self._schema_node_rects: dict = {}  # node_id → (x,y,w,h) for tooltips
        self._tooltip_id = None
        self._pinned: set[str] = set()  # pinned note stems
        self._sort_mode = "name"  # name | date | size
        self._vault_search_visible = False
        self._ai_panel_visible = False  # AI analysis panel toggle

        # AI Task System
        self._ai_tasks: list[dict] = []  # {id, text, status, progress, result, created}
        self._ai_task_counter = 0
        self._ai_activity_log: list[tuple[float, str, str]] = []  # (time, level, msg)
        self._hive_task_line_map: list[tuple[int, int, int]] = []  # task list line ranges -> task ids
        self._ai_processing_task: dict | None = None
        self._ai_process_tick = 0
        self._ai_neurons: list[dict] = []  # neural vis nodes
        self._ai_synapses: list[dict] = []  # neural vis connections
        self._ai_pulses: list[dict] = []  # traveling light pulses
        self._ai_hive_initialized = False
        self._ai_thought_bubbles: list[dict] = []  # floating thoughts on hive canvas
        self._ai_knowledge_score = 0
        self._recent_files: list[Path] = []  # last N opened files
        self._focus_mode = False  # distraction-free mode
        self._hive_ambient_tick = 0  # ambient idle animation counter
        self._note_snapshots: dict[str, list[tuple[str, str]]] = {}  # stem → [(timestamp, content)]
        self._graph_drag_node: str | None = None  # currently dragged graph node
        self._graph_press_node: str | None = None  # pressed graph node awaiting click/drag resolution
        self._graph_press_xy: tuple[int, int] | None = None  # initial mouse-down position on graph
        self._graph_dragged = False  # whether current graph press turned into a drag
        self._graph_custom_positions: dict[str, tuple[float, float]] = {}  # custom graph layout
        self._graph_layout_mode: str = "circular"  # circular | force | radial
        self._graph_starfield = StarField(120)  # starfield for graph background
        self._graph_flow_particles: list[FlowParticle] = []  # animated edge particles
        self._graph_anim_phase: float = 0.0  # animation phase counter
        self._selected_pipeline_node: str | None = None  # clicked schema node
        # AI real-time graph activity
        self._graph_ai_active_nodes: dict[str, dict] = {}  # node_stem → {stage, t_start, intensity}
        self._graph_ai_scan_waves: list[dict] = []  # {x, y, r, max_r, color, t_start}
        self._graph_ai_trails: list[dict] = []  # {x1, y1, x2, y2, progress, color}
        self._graph_ai_stage: str = ""  # current pipeline stage label
        self._graph_ai_stage_color: str = P["text_dim"]  # current stage color
        self._last_graph_draw_t: float = 0.0  # throttle graph redraws
        self._hive_dirty: bool = True  # dirty-bit for hive view redraw
        self._schema_dirty: bool = True  # dirty-bit for schema view redraw
        self._last_hive_draw_t: float = 0.0  # throttle hive redraws
        self._last_schema_draw_t: float = 0.0  # throttle schema redraws
        self._importance_cache: dict[str, float] = {}  # cached importance scores
        self._importance_cache_time: float = 0.0  # timestamp of last computation
        _IMPORTANCE_CACHE_MAX = 500  # max entries before trim
        self._hive_constellations: list[dict] = []  # twinkling idle stars
        self._zoom_level = 0  # zoom offset: -4..+8 from base size 11
        self._last_canvas_size: dict[str, tuple[int, int]] = {}  # track resize

        # Multi-tab state
        self._open_tabs: list[dict] = []  # [{path, content, cursor, modified}]
        self._active_tab_idx: int = -1
        self._tab_drag_idx: int | None = None  # drag & drop reordering

        # Split view
        self._split_active = False
        self._split_file: Path | None = None  # file shown in split pane
        self._outline_lines: list[int] = []  # outline listbox index -> editor line number
        self._bookmarks: dict[str, list[int]] = {}  # stem → [line_numbers]

        # Reading Time + Word Goal
        self._word_goal: int = 0  # 0 = no goal

        # Folder support
        self._expanded_folders: set[str] = set()  # expanded folder relative paths

        # Trash (soft-delete)
        self._trash_path = self.vault_path / ".trash"
        self._trash_path.mkdir(exist_ok=True)

        # Bookmarks: {note_stem: [(line, label), ...]}
        self._bookmarks: dict[str, list[tuple[int, str]]] = {}

        # Link hover preview
        self._link_preview_win: tk.Toplevel | None = None
        self._link_preview_after_id: str | None = None

        # Pomodoro timer
        self._pomo_running = False
        self._pomo_remaining = 0  # seconds
        self._pomo_mode = "work"  # work | break
        self._pomo_work_secs = 25 * 60
        self._pomo_break_secs = 5 * 60
        self._pomo_sessions = 0

        # Debounce timers
        self._syntax_after_id: str | None = None
        self._minimap_after_id: str | None = None
        self._file_tree_after_id: str | None = None
        self._tab_update_ids: list[str] = []  # deferred minimap/related/mood
        self._closing = False  # set True on window close

        # Vault content cache: {filepath → (mtime, content)}
        self._file_content_cache: dict[Path, tuple[float, str]] = {}

        # Pipeline simulator
        self.pipeline = PipelineSimulator()

        # Particle systems
        self.particles_schema = ParticleSystem(80)

        # Flow particles (data flowing between pipeline nodes)
        self._flow_particles: list[FlowParticle] = []
        self._schema_positions: dict = {}

        # Starfield for schema background
        self._starfield = StarField(150)

        # Build UI
        self._build_titlebar()
        self._build_main_layout()
        self._build_sidebar()
        self._build_editor()
        self._build_right_panel()
        self._build_hive_view()
        self._build_statusbar()

        # Load vault (synchronous on startup)
        self._refresh_file_tree_now()
        self._rebuild_graph_data()

        # Shortcuts
        self.root.bind("<Control-n>", lambda e: self._new_note())
        self.root.bind("<Control-s>", lambda e: self._save_note())
        self.root.bind("<Control-f>", lambda e: self._toggle_search())
        self.root.bind("<Control-g>", lambda e: self._show_graph())
        self.root.bind("<Control-p>", lambda e: self._show_schema())
        self.root.bind("<Control-e>", lambda e: self._show_editor())
        self.root.bind("<Control-r>", lambda e: self._show_preview())
        self.root.bind("<Control-question>", lambda e: self._show_shortcuts())
        self.root.bind("<F1>", lambda e: self._show_shortcuts())
        self.root.bind("<Delete>", lambda e: self._delete_note())
        self.root.bind("<Control-Shift-F>", lambda e: self._toggle_vault_search())
        self.root.bind("<Control-Shift-E>", lambda e: self._export_html())
        self.root.bind("<Control-k>", lambda e: self._show_ai_palette())
        self.root.bind("<Control-h>", lambda e: self._show_hive())
        self.root.bind("<Control-Shift-Z>", lambda e: self._toggle_focus_mode())
        self.root.bind("<Control-t>", lambda e: self._show_timeline())
        self.root.bind("<Control-Shift-S>", lambda e: self._take_snapshot())
        self.root.bind("<Control-equal>", lambda e: self._zoom_in())
        self.root.bind("<Control-plus>", lambda e: self._zoom_in())
        self.root.bind("<Control-minus>", lambda e: self._zoom_out())
        self.root.bind("<Control-0>", lambda e: self._zoom_reset())
        self.root.bind("<Control-MouseWheel>", self._on_ctrl_scroll)
        self.root.bind("<Control-Shift-P>", lambda e: self._show_command_palette())
        self.root.bind("<Control-w>", lambda e: self._close_active_tab())
        self.root.bind("<Control-Tab>", lambda e: self._cycle_tab(1))
        self.root.bind("<Control-Shift-Tab>", lambda e: self._cycle_tab(-1))
        self.root.bind("<Control-Shift-X>", lambda e: self._export_task_history())
        self.root.bind("<Control-m>", lambda e: self._toggle_bookmark())

        # Toast overlay label (hidden until _show_toast is called)
        self._toast_label = tk.Label(
            self.root, text="", font=F_SMALL, fg=P["ice"],
            bg=P["surface"], padx=14, pady=6, relief="solid", bd=1,
        )
        self._toast_after_id: str | None = None

        # Open Welcome
        welcome = self.vault_path / "Welcome.md"
        if welcome.exists():
            self._open_file(welcome)

        # Start animation loop
        self._anim_tick = 0
        self._animate()

    # ─── CACHED FILE READ ──────────────────────────────────────────
    _FILE_CACHE_MAX = 200

    def _read_cached(self, fp: Path) -> str:
        """Read file content with mtime-based cache to avoid repeated I/O."""
        try:
            mtime = fp.stat().st_mtime
            cached = self._file_content_cache.get(fp)
            if cached and cached[0] == mtime:
                return cached[1]
            content = fp.read_text(encoding="utf-8")
            # Evict oldest entries when cache exceeds limit
            if len(self._file_content_cache) >= self._FILE_CACHE_MAX:
                to_remove = sorted(
                    self._file_content_cache, key=lambda k: self._file_content_cache[k][0]
                )[:len(self._file_content_cache) - self._FILE_CACHE_MAX + 1]
                for k in to_remove:
                    del self._file_content_cache[k]
            self._file_content_cache[fp] = (mtime, content)
            return content
        except FileNotFoundError:
            self._file_content_cache.pop(fp, None)
            return ""
        except (OSError, UnicodeDecodeError) as e:
            print(f"[WARN] Cannot read {fp.name}: {e}")
            self._file_content_cache.pop(fp, None)
            return ""

    def _invalidate_cache(self, fp: Path | None = None):
        """Invalidate content cache for a file, or entire cache if fp is None."""
        if fp is None:
            self._file_content_cache.clear()
        else:
            self._file_content_cache.pop(fp, None)

    # ─── VIEW SWITCHING HELPER ──────────────────────────────────────
    def _hide_all_views(self):
        """Pack-forget all view frames."""
        for frame in (self.editor_container, self.graph_frame,
                      self.schema_frame, self.preview_frame,
                      self.hive_frame, self.timeline_frame,
                      self.cards_frame):
            frame.pack_forget()
        if hasattr(self, 'split_container'):
            self.split_container.pack_forget()
        self._graph_drag_node = None

    def _shutdown(self):
        """Stop UI activity and close the application without scheduling more work."""
        if self._closing:
            return
        self._closing = True

        if self.modified and self.current_file:
            try:
                content = self.editor.get("1.0", "end-1c")
                self.current_file.write_text(content, encoding="utf-8")
            except Exception:
                pass

        try:
            after_ids = self.root.tk.splitlist(self.root.tk.call("after", "info"))
        except Exception:
            after_ids = ()
        for aid in after_ids:
            try:
                self.root.after_cancel(aid)
            except Exception:
                pass

        try:
            self.root.grab_release()
        except Exception:
            pass
        for child in self.root.winfo_children():
            try:
                child.grab_release()
            except Exception:
                pass
            try:
                if child.winfo_class() == "Toplevel":
                    child.destroy()
            except Exception:
                pass

        try:
            self.root.quit()
        except Exception:
            pass
        try:
            self.root.destroy()
        except Exception:
            pass

    def _close_modal_window(self, win: tk.Toplevel, event=None):
        """Release modal grab and destroy a popup window safely."""
        try:
            win.grab_release()
        except Exception:
            pass
        try:
            win.destroy()
        except Exception:
            pass

    def _prepare_modal(self, win: tk.Toplevel):
        """Configure a modal Toplevel with safe close behavior."""
        def _close_modal(event=None):
            self._close_modal_window(win, event)

        win.transient(self.root)
        win.protocol("WM_DELETE_WINDOW", _close_modal)
        win.bind("<Escape>", _close_modal)
        try:
            win.grab_set()
        except Exception:
            pass
        return win

    # ─── TITLE BAR ─────────────────────────────────────────────────
    def _build_titlebar(self):
        bar = tk.Frame(self.root, bg=P["void"], height=40)
        bar.pack(fill="x", side="top")
        bar.pack_propagate(False)

        # Pixel art logo from generated asset
        logo_img = _load_icon("logo_hive", (28, 28))
        if logo_img:
            logo_lbl = tk.Label(bar, image=logo_img, bg=P["void"])
            logo_lbl.pack(side="left", padx=(10, 4), pady=6)
        else:
            icon_canvas = tk.Canvas(bar, width=28, height=28, bg=P["void"],
                                    highlightthickness=0)
            icon_canvas.pack(side="left", padx=(10, 4), pady=6)
            ic = icon_canvas
            ic.create_rectangle(4, 4, 8, 8, fill=P["cyan"], outline="")
            ic.create_rectangle(8, 8, 12, 12, fill=P["cyan_dim"], outline="")
            ic.create_rectangle(12, 12, 16, 16, fill=P["amethyst_dim"], outline="")
            ic.create_rectangle(16, 16, 20, 20, fill=P["amethyst_dim"], outline="")
            ic.create_rectangle(20, 20, 24, 24, fill=P["ember"], outline="")
            ic.create_rectangle(2, 8, 6, 12, fill=P["ice"], outline="")
            ic.create_rectangle(8, 2, 12, 6, fill=P["ice"], outline="")

        tk.Label(bar, text="Shumilek Hive",
                 font=(FONT, 13, "bold"), fg=P["text_bright"], bg=P["void"]
        ).pack(side="left", padx=(2, 6))

        tk.Label(bar, text="living AI hub",
                 font=F_SMALL, fg=P["text_dim"], bg=P["void"]
        ).pack(side="left")

        # Right side buttons — with pixel art icons
        bs = dict(font=F_SMALL, bg=P["void"], fg=P["text_dim"],
                  activebackground=P["panel"], activeforeground=P["cyan"],
                  bd=0, padx=8, pady=4, cursor="hand2")

        self._tb_icons = {}  # keep references
        def _icon_btn(parent, icon_name, text, command, side="right", **extra_bs):
            """Create a button with pixel art icon if available, else text."""
            merged = {**bs, **extra_bs}
            ico = _load_icon(icon_name, (18, 18))
            if ico:
                self._tb_icons[icon_name] = ico
                btn = tk.Button(parent, image=ico, text=f" {text}", compound="left",
                                command=command, **merged)
            else:
                btn = tk.Button(parent, text=text, command=command, **merged)
            btn.pack(side=side, padx=3)
            return btn

        _icon_btn(bar, "icon_pipeline", "Schema", self._show_schema)
        _icon_btn(bar, "icon_graph", "Graph", self._show_graph)
        _icon_btn(bar, "icon_preview", "Preview", self._show_preview)
        _icon_btn(bar, "icon_editor", "Editor", self._show_editor)
        _icon_btn(bar, "icon_search", "Search", self._toggle_search)
        _icon_btn(bar, "icon_save", "Export", self._export_html)
        _icon_btn(bar, "icon_new", "New", self._new_note)
        _icon_btn(bar, "icon_ai_star", "AI", self._show_ai_palette,
                  fg=P["cyan"])
        _icon_btn(bar, "icon_hive", "Hive", self._show_hive,
                  fg=P["emerald"])
        _icon_btn(bar, "icon_timeline", "Timeline", self._show_timeline)
        _icon_btn(bar, "icon_goal", "Cards", self._show_cards,
                  fg=P["ice"])

        tk.Button(bar, text="\u2318", command=self._show_command_palette,
                  font=F_PIXEL, bg=P["void"], fg=P["text_dim"],
                  activebackground=P["panel"], activeforeground=P["cyan"],
                  bd=0, padx=6, pady=4, cursor="hand2").pack(side="right", padx=3)

    # ─── MAIN LAYOUT ──────────────────────────────────────────────
    def _build_main_layout(self):
        self.main_frame = tk.Frame(self.root, bg=P["obsidian"])
        self.main_frame.pack(fill="both", expand=True, padx=2)
        self.main_frame.columnconfigure(0, minsize=230)
        self.main_frame.columnconfigure(1, weight=1)
        self.main_frame.columnconfigure(2, minsize=250)
        self.main_frame.rowconfigure(0, weight=1)

    # ─── LEFT SIDEBAR ─────────────────────────────────────────────
    def _build_sidebar(self):
        self.sidebar = tk.Frame(self.main_frame, bg=P["panel"], width=230)
        self.sidebar.grid(row=0, column=0, sticky="nsew", padx=(2, 1), pady=2)
        self.sidebar.grid_propagate(False)

        # Vault header with texture
        hdr_canvas = tk.Canvas(self.sidebar, height=34, bg=P["surface"],
                               highlightthickness=0)
        hdr_canvas.pack(fill="x")
        hdr_canvas.create_text(10, 17, text="VAULT", font=F_HEAD,
                               fill=P["cyan"], anchor="w")
        # Pixel art decoration in header
        vault_deco = _load_icon("crystal_star", (22, 22))
        if vault_deco:
            self._vault_deco_img = vault_deco
            hdr_canvas.create_image(210, 17, image=vault_deco)
        else:
            for i in range(5):
                hdr_canvas.create_rectangle(200-i*8, 14, 204-i*8, 18,
                                            fill=P["cyan_dim"], outline="")

        # New note button (with pixel art icons)
        btn_frame = tk.Frame(self.sidebar, bg=P["panel"])
        btn_frame.pack(fill="x", padx=6, pady=(4, 2))
        self._sb_icons = {}

        def _sb_icon_btn(parent, icon_name, text, command, fg_color=P["emerald"], **kw):
            ico = _load_icon(icon_name, (16, 16))
            if ico:
                self._sb_icons[icon_name] = ico
                btn = tk.Button(parent, image=ico, text=f" {text}", compound="left",
                                font=F_SMALL, fg=fg_color, bg=P["panel"],
                                activebackground=P["hover"], activeforeground=P["cyan"],
                                bd=0, cursor="hand2", command=command, **kw)
            else:
                btn = tk.Button(parent, text=text, font=F_SMALL,
                                fg=fg_color, bg=P["panel"],
                                activebackground=P["hover"], activeforeground=P["cyan"],
                                bd=0, cursor="hand2", command=command, **kw)
            return btn

        _sb_icon_btn(btn_frame, "icon_new", "+ new", self._new_note,
                     fg_color=P["emerald"]).pack(side="left")
        _sb_icon_btn(btn_frame, "icon_folder", "\U0001f4c1", self._new_folder,
                     fg_color=P["ice"]).pack(side="left", padx=2)
        tk.Button(btn_frame, text="today", font=F_SMALL,
                  fg=P["ice"], bg=P["panel"],
                  activebackground=P["hover"], activeforeground=P["cyan"],
                  bd=0, cursor="hand2", command=self._new_daily_note
        ).pack(side="left", padx=4)
        # Template menu button
        self._tmpl_btn = tk.Menubutton(btn_frame, text="tmpl", font=F_SMALL,
                  fg=P["amethyst"], bg=P["panel"],
                  activebackground=P["hover"], activeforeground=P["cyan"],
                  bd=0, cursor="hand2", relief="flat")
        self._tmpl_btn.pack(side="left", padx=2)
        tmpl_menu = tk.Menu(self._tmpl_btn, tearoff=0,
                            bg=P["surface"], fg=P["text"],
                            activebackground=P["hover"],
                            activeforeground=P["cyan"], font=F_SMALL)
        for tname in ("Meeting Notes", "Project Idea", "Character Sheet", "Bug Report"):
            tmpl_menu.add_command(label=tname,
                                  command=lambda n=tname: self._new_from_template(n))
        self._tmpl_btn.config(menu=tmpl_menu)
        _sb_icon_btn(btn_frame, "icon_delete", "x del", self._delete_note,
                     fg_color=P["rose"]).pack(side="right")
        _sb_icon_btn(btn_frame, "icon_pin", "\u2605 pin", self._toggle_pin,
                     fg_color=P["ember"]).pack(side="right", padx=2)

        # Sort options
        sort_frame = tk.Frame(self.sidebar, bg=P["panel"])
        sort_frame.pack(fill="x", padx=6, pady=(0, 2))
        tk.Label(sort_frame, text="sort:", font=F_PIXEL,
                 fg=P["text_dim"], bg=P["panel"]).pack(side="left")
        for mode, label in [("name", "A-Z"), ("date", "date"), ("size", "size")]:
            tk.Button(sort_frame, text=label, font=F_PIXEL,
                      fg=P["text_dim"], bg=P["panel"],
                      activebackground=P["hover"], activeforeground=P["cyan"],
                      bd=0, cursor="hand2",
                      command=lambda m=mode: self._set_sort(m)
            ).pack(side="left", padx=2)

        # Global vault search bar (hidden by default)
        self.vault_search_bar = tk.Frame(self.sidebar, bg=P["surface"])
        self.vault_search_var = tk.StringVar()
        tk.Label(self.vault_search_bar, text="\U0001f50d", font=F_PIXEL,
                 fg=P["text_dim"], bg=P["surface"]).pack(side="left", padx=(4, 2))
        self.vault_search_entry = tk.Entry(
            self.vault_search_bar, textvariable=self.vault_search_var,
            font=F_SMALL, bg=P["panel"], fg=P["text"],
            insertbackground=P["cyan"], bd=0,
            highlightthickness=1, highlightcolor=P["cyan"],
            highlightbackground=P["border"]
        )
        self.vault_search_entry.pack(side="left", fill="x", expand=True, padx=2, pady=2)
        self.vault_search_entry.bind("<Return>", lambda e: self._do_vault_search())
        self.vault_search_entry.bind("<Escape>", lambda e: self._toggle_vault_search())
        tk.Button(self.vault_search_bar, text="x", font=F_PIXEL,
                  bg=P["surface"], fg=P["text_dim"],
                  activebackground=P["hover"], bd=0,
                  command=self._toggle_vault_search, cursor="hand2"
        ).pack(side="right", padx=2)

        self.vault_search_results = tk.Listbox(
            self.sidebar, font=F_SMALL, bg=P["panel_alt"], fg=P["text"],
            selectbackground=P["surface"], selectforeground=P["cyan"],
            activestyle="none", bd=0, height=0,
            highlightthickness=0, relief="flat", cursor="hand2"
        )
        self.vault_search_results.bind("<<ListboxSelect>>", self._on_vault_search_select)

        # Recent Files
        self.recent_frame = tk.Frame(self.sidebar, bg=P["panel"])
        self.recent_frame.pack(fill="x", padx=4, pady=(2, 0))
        recent_hdr = tk.Canvas(self.recent_frame, height=20, bg=P["surface"],
                               highlightthickness=0)
        recent_hdr.pack(fill="x")
        recent_hdr.create_text(8, 10, text="RECENT", font=F_PIXEL,
                               fill=P["ice"], anchor="w")
        self.recent_listbox = tk.Listbox(
            self.recent_frame, font=F_SMALL, bg=P["panel"], fg=P["ice"],
            selectbackground=P["surface"], selectforeground=P["cyan"],
            activestyle="none", bd=0, height=3,
            highlightthickness=0, relief="flat", cursor="hand2"
        )
        self.recent_listbox.pack(fill="x")
        self.recent_listbox.bind("<<ListboxSelect>>", self._on_recent_select)
        self.recent_listbox.bind("<Motion>", lambda e: self._on_listbox_hover(e, self.recent_listbox))
        self.recent_listbox.bind("<Leave>", lambda e: self._on_listbox_leave(self.recent_listbox))

        # Search
        self.sidebar_search_var = tk.StringVar()
        self.sidebar_search_var.trace_add("write", lambda *_: self._filter_tree())
        sf = tk.Frame(self.sidebar, bg=P["panel"])
        sf.pack(fill="x", padx=6, pady=(2, 4))
        self.sidebar_search = tk.Entry(
            sf, textvariable=self.sidebar_search_var,
            font=F_SMALL, bg=P["surface"], fg=P["text"],
            insertbackground=P["cyan"], bd=0,
            highlightthickness=1, highlightcolor=P["border_glow"],
            highlightbackground=P["border"]
        )
        self.sidebar_search.pack(fill="x")

        # File list
        tree_frame = tk.Frame(self.sidebar, bg=P["panel"])
        tree_frame.pack(fill="both", expand=True, padx=4, pady=2)
        self.file_listbox = tk.Listbox(
            tree_frame, font=F_MONO, bg=P["panel"], fg=P["text"],
            selectbackground=P["surface"], selectforeground=P["cyan"],
            activestyle="none", bd=0, highlightthickness=0,
            relief="flat", cursor="hand2"
        )
        self.file_listbox.pack(fill="both", expand=True)
        self.file_listbox.bind("<<ListboxSelect>>", self._on_file_select)
        self.file_listbox.bind("<Button-3>", self._on_file_right_click)
        self.file_listbox.bind("<Motion>", lambda e: self._on_listbox_hover(e, self.file_listbox))
        self.file_listbox.bind("<Leave>", lambda e: self._on_listbox_leave(self.file_listbox))

        # Context menu
        self.file_ctx_menu = tk.Menu(self.root, tearoff=0,
                                      bg=P["surface"], fg=P["text"],
                                      activebackground=P["hover"],
                                      activeforeground=P["cyan"],
                                      font=F_SMALL, bd=1,
                                      relief="solid")
        self.file_ctx_menu.add_command(label="Open", command=self._ctx_open)
        self.file_ctx_menu.add_command(label="Delete", command=self._delete_note)
        self.file_ctx_menu.add_command(label="Rename", command=self._rename_note)
        self.file_ctx_menu.add_separator()
        self.file_ctx_menu.add_command(label="\u2605 Pin/Unpin", command=self._toggle_pin)
        self.file_ctx_menu.add_command(label="\U0001f4c1 New Folder", command=self._new_folder)
        self.file_ctx_menu.add_command(label="Export HTML", command=self._export_html)
        self.file_ctx_menu.add_command(label="\u231b Snapshots", command=self._show_snapshots)
        self.file_ctx_menu.add_command(label="\U0001f5d1 View Trash", command=self._show_trash)

        # Graph context menu
        self.graph_ctx_menu = tk.Menu(self.root, tearoff=0,
                                       bg=P["surface"], fg=P["text"],
                                       activebackground=P["hover"],
                                       activeforeground=P["cyan"],
                                       font=F_SMALL, bd=1,
                                       relief="solid")
        self.graph_ctx_menu.add_command(label="Open", command=self._graph_ctx_open)
        self.graph_ctx_menu.add_command(label="\u2605 Pin/Unpin", command=self._graph_ctx_pin)
        self.graph_ctx_menu.add_command(label="Rename", command=self._graph_ctx_rename)
        self.graph_ctx_menu.add_separator()
        self.graph_ctx_menu.add_command(label="\U0001f517 Show Links", command=self._graph_ctx_links)
        self._graph_ctx_node: str | None = None

        # Editor context menu
        self.editor_ctx_menu = tk.Menu(self.root, tearoff=0,
                                        bg=P["surface"], fg=P["text"],
                                        activebackground=P["hover"],
                                        activeforeground=P["cyan"],
                                        font=F_SMALL, bd=1,
                                        relief="solid")
        self.editor_ctx_menu.add_command(label="Cut", command=self._editor_ctx_cut)
        self.editor_ctx_menu.add_command(label="Copy", command=self._editor_ctx_copy)
        self.editor_ctx_menu.add_command(label="Paste", command=self._editor_ctx_paste)
        self.editor_ctx_menu.add_separator()
        self.editor_ctx_menu.add_command(label="Bold  (Ctrl+B)", command=self._format_bold)
        self.editor_ctx_menu.add_command(label="Italic  (Ctrl+I)", command=self._format_italic)
        self.editor_ctx_menu.add_command(label="Code  (Ctrl+Shift+C)", command=self._format_code)
        self.editor_ctx_menu.add_command(label="Link  (Ctrl+L)", command=self._format_link)
        self.editor_ctx_menu.add_separator()
        self.editor_ctx_menu.add_command(label="Heading", command=self._format_heading)
        self.editor_ctx_menu.add_command(label="\u2610 Checkbox", command=self._format_checkbox)

        # Tags
        tag_canvas = tk.Canvas(self.sidebar, height=24, bg=P["surface"],
                               highlightthickness=0)
        tag_canvas.pack(fill="x")
        tag_canvas.create_text(10, 12, text="TAGS", font=F_SMALL,
                               fill=P["amethyst"], anchor="w")
        # Tag header pixel art deco
        tag_deco = _load_icon("icon_ai_star", (16, 16))
        if tag_deco:
            self._tag_deco_img = tag_deco
            tag_canvas.create_image(200, 12, image=tag_deco)
        else:
            for i in range(3):
                tag_canvas.create_rectangle(198-i*6, 10, 202-i*6, 14,
                                            fill=P["amethyst_dim"], outline="")

        self.tag_listbox = tk.Listbox(
            self.sidebar, font=F_SMALL, bg=P["panel"], fg=P["tag"],
            selectbackground=P["surface"], selectforeground=P["cyan"],
            activestyle="none", bd=0, height=5,
            highlightthickness=0, relief="flat", cursor="hand2"
        )
        self.tag_listbox.pack(fill="x", padx=4, pady=(2, 0))
        self.tag_listbox.bind("<<ListboxSelect>>", self._on_tag_select)
        self.tag_listbox.bind("<Motion>", lambda e: self._on_listbox_hover(e, self.tag_listbox))
        self.tag_listbox.bind("<Leave>", lambda e: self._on_listbox_leave(self.tag_listbox))

        # Tag Cloud canvas (visual weighted tags)
        self.tag_cloud_canvas = tk.Canvas(self.sidebar, height=70, bg=P["panel"],
                                          highlightthickness=0, cursor="hand2")
        self.tag_cloud_canvas.pack(fill="x", padx=4, pady=(0, 4))
        self.tag_cloud_canvas.bind("<Button-1>", self._on_tag_cloud_click)
        self._tag_cloud_items: list[tuple[str, int, int, int, int]] = []  # (tag, x1, y1, x2, y2)

        # Bookmarks section
        bm_header = tk.Canvas(self.sidebar, height=20, bg=P["surface"],
                               highlightthickness=0)
        bm_header.pack(fill="x")
        bm_header.create_text(10, 10, text="\U0001f516 BOOKMARKS", font=F_PIXEL,
                               fill=P["amethyst"], anchor="w")
        self.bookmark_listbox = tk.Listbox(
            self.sidebar, height=4, font=F_SMALL,
            bg=P["panel"], fg=P["text"],
            selectbackground=P["hover"], selectforeground=P["cyan"],
            activestyle="none", bd=0, highlightthickness=0,
            relief="flat", cursor="hand2"
        )
        self.bookmark_listbox.pack(fill="x", padx=4, pady=(2, 4))
        self.bookmark_listbox.bind("<<ListboxSelect>>", self._on_bookmark_select)

        # Decorative honeycomb at sidebar bottom
        sidebar_deco = _load_icon("deco_honeycomb", (20, 60))
        if sidebar_deco:
            self._sidebar_deco_img = sidebar_deco
            tk.Label(self.sidebar, image=sidebar_deco, bg=P["panel"]).pack(
                side="bottom", pady=4)

    # ─── CENTER: EDITOR + GRAPH + SCHEMA ─────────────────────────
    def _build_editor(self):
        self.center_frame = tk.Frame(self.main_frame, bg=P["obsidian"])
        self.center_frame.grid(row=0, column=1, sticky="nsew", padx=1, pady=2)

        # Tab bar (multi-tab)
        self.tab_bar = tk.Frame(self.center_frame, bg=P["void"], height=30)
        self.tab_bar.pack(fill="x")
        self.tab_bar.pack_propagate(False)

        self.tab_scroll_frame = tk.Frame(self.tab_bar, bg=P["void"])
        self.tab_scroll_frame.pack(side="left", fill="both", expand=True)

        self.view_indicator = tk.Label(self.tab_bar, text="EDITOR",
                                       font=F_PIXEL, fg=P["cyan_dim"], bg=P["void"])
        self.view_indicator.pack(side="right", padx=10)

        # Breadcrumb bar
        self.breadcrumb_bar = tk.Frame(self.center_frame, bg=P["panel_alt"], height=22)
        self.breadcrumb_bar.pack(fill="x")
        self.breadcrumb_bar.pack_propagate(False)
        self.breadcrumb_label = tk.Label(self.breadcrumb_bar, text="vault",
                                         font=F_PIXEL, fg=P["text_dim"],
                                         bg=P["panel_alt"], anchor="w", padx=8)
        self.breadcrumb_label.pack(side="left", fill="x", expand=True)

        # Search bar (hidden)
        self.search_bar = tk.Frame(self.center_frame, bg=P["surface"], height=34)
        self.search_entry_var = tk.StringVar()
        tk.Label(self.search_bar, text="find:", font=F_SMALL,
                 fg=P["text_dim"], bg=P["surface"]).pack(side="left", padx=(8, 4))
        self.search_entry = tk.Entry(
            self.search_bar, textvariable=self.search_entry_var,
            font=F_MONO, bg=P["panel"], fg=P["text"],
            insertbackground=P["cyan"], bd=0,
            highlightthickness=1, highlightcolor=P["cyan"],
            highlightbackground=P["border"]
        )
        self.search_entry.pack(side="left", fill="x", expand=True, padx=4, pady=4)
        self.search_entry.bind("<Return>", lambda e: self._do_search())
        self.search_entry.bind("<Escape>", lambda e: self._toggle_search())
        self._search_regex_var = tk.BooleanVar(value=False)
        tk.Checkbutton(self.search_bar, text=".*", variable=self._search_regex_var,
                       font=F_PIXEL, fg=P["text_dim"], bg=P["surface"],
                       selectcolor=P["panel"], activebackground=P["surface"],
                       activeforeground=P["cyan"], bd=0
        ).pack(side="right", padx=2)
        tk.Button(self.search_bar, text="\u25bc", font=F_PIXEL,
                  bg=P["surface"], fg=P["text_dim"],
                  activebackground=P["hover"], bd=0,
                  command=self._search_next, cursor="hand2"
        ).pack(side="right", padx=1)
        tk.Button(self.search_bar, text="\u25b2", font=F_PIXEL,
                  bg=P["surface"], fg=P["text_dim"],
                  activebackground=P["hover"], bd=0,
                  command=self._search_prev, cursor="hand2"
        ).pack(side="right", padx=1)
        tk.Button(self.search_bar, text="x", font=F_SMALL,
                  bg=P["surface"], fg=P["text_dim"],
                  activebackground=P["hover"], bd=0,
                  command=self._toggle_search, cursor="hand2"
        ).pack(side="right", padx=4)
        self._search_match_idx = 0
        self._search_match_positions: list[str] = []

        # Replace bar (hidden)
        self.replace_bar = tk.Frame(self.center_frame, bg=P["surface"], height=30)
        self.replace_entry_var = tk.StringVar()
        tk.Label(self.replace_bar, text="replace:", font=F_SMALL,
                 fg=P["text_dim"], bg=P["surface"]).pack(side="left", padx=(8, 4))
        self.replace_entry = tk.Entry(
            self.replace_bar, textvariable=self.replace_entry_var,
            font=F_MONO, bg=P["panel"], fg=P["text"],
            insertbackground=P["cyan"], bd=0,
            highlightthickness=1, highlightcolor=P["cyan"],
            highlightbackground=P["border"]
        )
        self.replace_entry.pack(side="left", fill="x", expand=True, padx=4, pady=4)
        tk.Button(self.replace_bar, text="Replace All", font=F_PIXEL,
                  bg=P["surface"], fg=P["text_dim"],
                  activebackground=P["hover"], bd=0,
                  command=self._replace_all, cursor="hand2"
        ).pack(side="right", padx=4)
        tk.Button(self.replace_bar, text="Replace", font=F_PIXEL,
                  bg=P["surface"], fg=P["text_dim"],
                  activebackground=P["hover"], bd=0,
                  command=self._replace_one, cursor="hand2"
        ).pack(side="right", padx=2)

        # Editor container
        self.editor_container = tk.Frame(self.center_frame, bg=P["border"])
        self.editor_container.pack(fill="both", expand=True, padx=4, pady=4)

        # Line numbers
        self.line_numbers = tk.Text(
            self.editor_container, width=4, font=F_MONO,
            bg=P["panel_alt"], fg=P["text_dim"],
            bd=0, padx=4, pady=8, state="disabled", cursor="arrow",
            highlightthickness=0, relief="flat", takefocus=0
        )
        self.line_numbers.pack(side="left", fill="y")

        # Text editor
        self.editor = tk.Text(
            self.editor_container, font=F_MONO,
            bg=P["panel"], fg=P["text"],
            insertbackground=P["cyan"], insertwidth=2,
            bd=0, padx=12, pady=8, undo=True, autoseparators=True,
            wrap="word", spacing1=2, spacing3=2,
            highlightthickness=0, relief="flat",
            selectbackground=P["surface"], selectforeground=P["text_bright"]
        )
        self.editor.pack(fill="both", expand=True)

        # Scrollbar
        sb = tk.Scrollbar(self.editor_container, command=self._on_editor_scroll,
                          bg=P["panel"], troughcolor=P["obsidian"],
                          activebackground=P["border_glow"],
                          highlightthickness=0, bd=0)
        sb.pack(side="right", fill="y")
        self._editor_scrollbar = sb
        self.editor.config(yscrollcommand=self._on_editor_yscroll)

        # Text tags — NO yellow
        self.editor.tag_configure("heading1", font=(FONT, 18, "bold"), foreground=P["heading"])
        self.editor.tag_configure("heading2", font=(FONT, 15, "bold"), foreground=P["heading"])
        self.editor.tag_configure("heading3", font=F_HEAD, foreground=P["amethyst"])
        self.editor.tag_configure("bold", font=(FONT, 11, "bold"), foreground=P["text_bright"])
        self.editor.tag_configure("italic", font=(FONT, 11, "italic"))
        self.editor.tag_configure("code", font=(FONT, 10), background=P["surface"], foreground=P["code_fg"])
        self.editor.tag_configure("link", foreground=P["link"], underline=True)
        self.editor.tag_configure("tag", foreground=P["tag"])
        self.editor.tag_configure("quote", foreground=P["text_dim"], lmargin1=20, lmargin2=20)
        self.editor.tag_configure("bullet", foreground=P["cyan_dim"])
        self.editor.tag_configure("hr", foreground=P["border_glow"])
        self.editor.tag_configure("search_match", background=P["amethyst_dim"], foreground=P["text_bright"])
        self.editor.tag_configure("table_header", foreground=P["ice"], font=(FONT, 11, "bold"))
        self.editor.tag_configure("task_done", foreground=P["ok"], overstrike=True)
        self.editor.tag_configure("task_open", foreground=P["rose"])

        self.editor.bind("<<Modified>>", self._on_modified)
        self.editor.bind("<KeyRelease>", self._on_key_release)
        self.editor.bind("<Control-Button-1>", self._on_ctrl_click)
        self.editor.bind("<Button-1>", self._on_editor_click)
        self.editor.bind("<ButtonRelease-1>", lambda e: self._update_cursor_pos())
        self.editor.bind("<bracketleft>", self._on_bracket, add="+")
        self.editor.bind("<Motion>", self._on_editor_motion)
        self.editor.bind("<Button-3>", self._on_editor_right_click)
        self.editor.bind("<Control-b>", lambda e: self._format_bold())
        self.editor.bind("<Control-i>", lambda e: self._format_italic())
        self.editor.bind("<Control-l>", lambda e: self._format_link())
        self.editor.bind("<Control-Shift-C>", lambda e: self._format_code())

        # Wiki-link autocomplete popup
        self._autocomplete_popup = tk.Listbox(
            self.editor, font=F_SMALL, bg=P["surface"], fg=P["text"],
            selectbackground=P["hover"], selectforeground=P["cyan"],
            activestyle="none", bd=1, relief="solid",
            highlightthickness=0, cursor="hand2", height=6,
            exportselection=False
        )
        self._autocomplete_popup.bind("<<ListboxSelect>>", self._on_autocomplete_select)
        self._autocomplete_visible = False
        self.editor.bind("<Tab>", self._on_autocomplete_key, add="+")

        # Preview pane (hidden)
        self.preview_frame = tk.Frame(self.center_frame, bg=P["panel"])
        self.preview_text = tk.Text(
            self.preview_frame, font=(FONT, 12),
            bg=P["panel"], fg=P["text"],
            bd=0, padx=20, pady=16, wrap="word",
            spacing1=4, spacing3=4,
            highlightthickness=0, relief="flat",
            state="disabled", cursor="arrow",
            selectbackground=P["surface"], selectforeground=P["text_bright"]
        )
        self.preview_text.pack(fill="both", expand=True)
        # Preview tags
        self.preview_text.tag_configure("h1", font=(FONT, 22, "bold"), foreground=P["heading"],
                                         spacing1=12, spacing3=8)
        self.preview_text.tag_configure("h2", font=(FONT, 17, "bold"), foreground=P["heading"],
                                         spacing1=10, spacing3=6)
        self.preview_text.tag_configure("h3", font=F_HEAD, foreground=P["amethyst"],
                                         spacing1=8, spacing3=4)
        self.preview_text.tag_configure("p_bold", font=(FONT, 12, "bold"), foreground=P["text_bright"])
        self.preview_text.tag_configure("p_code", font=(FONT, 10), background=P["surface"],
                                         foreground=P["code_fg"])
        self.preview_text.tag_configure("p_link", foreground=P["link"], underline=True)
        self.preview_text.tag_configure("p_quote", foreground=P["text_dim"],
                                         lmargin1=24, lmargin2=24, font=(FONT, 11, "italic"),
                                         background=P["panel_alt"])
        self.preview_text.tag_configure("p_tag", foreground=P["tag"])
        self.preview_text.tag_configure("p_hr", foreground=P["border_glow"], justify="center",
                                         spacing1=8, spacing3=8)
        self.preview_text.tag_configure("p_bullet", foreground=P["text"], lmargin1=16, lmargin2=28)
        prev_sb = tk.Scrollbar(self.preview_frame, command=self.preview_text.yview,
                               bg=P["panel"], troughcolor=P["obsidian"],
                               activebackground=P["border_glow"],
                               highlightthickness=0, bd=0)
        prev_sb.pack(side="right", fill="y")
        self.preview_text.config(yscrollcommand=prev_sb.set)

        # Minimap canvas
        self.minimap_canvas = tk.Canvas(self.editor_container, width=60, bg=P["panel_alt"],
                                         highlightthickness=0)
        self.minimap_canvas.pack(side="right", fill="y", before=self.editor)
        self.minimap_canvas.bind("<Button-1>", self._on_minimap_click)

        # Split editor pane (hidden by default)
        self.split_container = tk.Frame(self.center_frame, bg=P["border"])
        self.split_header = tk.Frame(self.split_container, bg=P["void"], height=22)
        self.split_header.pack(fill="x")
        self.split_header.pack_propagate(False)
        self.split_label = tk.Label(self.split_header, text="SPLIT",
                                     font=F_PIXEL, fg=P["cyan_dim"], bg=P["void"])
        self.split_label.pack(side="left", padx=8)
        split_close = tk.Label(self.split_header, text="\u00d7", font=(FONT, 10),
                               fg=P["text_dim"], bg=P["void"], cursor="hand2")
        split_close.pack(side="right", padx=8)
        split_close.bind("<Button-1>", lambda e: self._close_split_view())
        self.split_editor = tk.Text(
            self.split_container, font=F_MONO,
            bg=P["panel"], fg=P["text"],
            insertbackground=P["amethyst"], insertwidth=2,
            bd=0, padx=12, pady=8, undo=True,
            wrap="word", spacing1=2, spacing3=2,
            highlightthickness=0, relief="flat",
            selectbackground=P["surface"], selectforeground=P["text_bright"]
        )
        self.split_editor.pack(fill="both", expand=True)

        # Graph canvas (hidden)
        self.graph_frame = tk.Frame(self.center_frame, bg=P["void"])
        # Graph layout toolbar
        self.graph_layout_bar = tk.Frame(self.graph_frame, bg=P["panel"], height=26)
        self.graph_layout_bar.pack(fill="x", side="top")
        self.graph_layout_bar.pack_propagate(False)
        tk.Label(self.graph_layout_bar, text="LAYOUT:", font=F_PIXEL,
                 bg=P["panel"], fg=P["text_dim"]).pack(side="left", padx=(6, 2))
        self._layout_buttons: dict[str, tk.Button] = {}
        for mode, lbl in [("circular", "\u25EF Circular"),
                           ("force", "\u2B24 Force"),
                           ("radial", "\u2738 Radial")]:
            btn = tk.Button(self.graph_layout_bar, text=lbl, font=F_PIXEL,
                            bg=P["surface"], fg=P["text"], bd=0,
                            activebackground=P["hover"],
                            activeforeground=P["text_bright"],
                            command=lambda m=mode: self._set_graph_layout(m))
            btn.pack(side="left", padx=2, pady=2)
            self._layout_buttons[mode] = btn
        self._layout_buttons["circular"].config(fg=P["cyan"])
        # Canvas area
        self.graph_canvas = tk.Canvas(self.graph_frame, bg=P["void"],
                                      highlightthickness=0, cursor="crosshair")
        self.graph_canvas.pack(fill="both", expand=True)
        self.graph_canvas.bind("<Button-1>", self._on_graph_click)
        self.graph_canvas.bind("<B1-Motion>", self._on_graph_drag)
        self.graph_canvas.bind("<ButtonRelease-1>", self._on_graph_release)
        self.graph_canvas.bind("<Configure>", lambda e: self._on_canvas_resize("graph"))
        self.graph_canvas.bind("<Motion>", self._on_graph_hover)
        self.graph_canvas.bind("<Button-3>", self._on_graph_right_click)
        # AI scenario controls bar
        self.graph_controls = tk.Frame(self.graph_frame, bg=P["panel"], height=28)
        self.graph_controls.pack(fill="x", side="bottom")
        tk.Label(self.graph_controls, text="AI SIM:", font=F_PIXEL,
                bg=P["panel"], fg=P["text_dim"]).pack(side="left", padx=(6, 2))
        for scn, lbl in [("success", "\u25B6 Success"), ("retry", "\u21BB Retry"),
                         ("hallucination", "\u2622 Halluc"), ("default", "\u25C8 Demo")]:
            tk.Button(self.graph_controls, text=lbl, font=F_PIXEL,
                     bg=P["surface"], fg=P["text"], bd=0,
                     activebackground=P["hover"], activeforeground=P["text_bright"],
                     command=lambda s=scn: self._graph_run_scenario(s)
                     ).pack(side="left", padx=2, pady=2)
        tk.Button(self.graph_controls, text="\u25A0 Reset", font=F_PIXEL,
                 bg=P["surface"], fg=P["text_dim"], bd=0,
                 activebackground=P["hover"], activeforeground=P["text_bright"],
                 command=self._graph_reset_ai
                 ).pack(side="left", padx=2, pady=2)
        self.graph_ai_status_lbl = tk.Label(self.graph_controls, text="idle",
                                            font=F_PIXEL, bg=P["panel"],
                                            fg=P["text_dim"])
        self.graph_ai_status_lbl.pack(side="right", padx=6)

        # Graph tooltip (hidden label over canvas)
        self.graph_tooltip = tk.Label(self.graph_canvas, text="",
                                       font=F_SMALL, bg=P["surface"],
                                       fg=P["text_bright"], bd=1,
                                       relief="solid", padx=6, pady=3,
                                       wraplength=220)

        # Schema canvas (hidden)
        self.schema_frame = tk.Frame(self.center_frame, bg=P["void"])

        # Top: schema canvas
        self.schema_top = tk.Frame(self.schema_frame, bg=P["void"])
        self.schema_top.pack(fill="both", expand=True)
        self.schema_canvas = tk.Canvas(self.schema_top, bg=P["void"],
                                       highlightthickness=0)
        self.schema_canvas.pack(fill="both", expand=True)
        self.schema_canvas.bind("<Motion>", self._on_schema_hover)
        self.schema_canvas.bind("<Button-1>", self._on_schema_click)
        self.schema_canvas.bind("<Configure>", lambda e: self._on_canvas_resize("schema"))

        # Tooltip (hidden label over canvas)
        self.schema_tooltip = tk.Label(self.schema_canvas, text="",
                                        font=F_SMALL, bg=P["surface"],
                                        fg=P["text_bright"], bd=1,
                                        relief="solid", padx=6, pady=3,
                                        wraplength=220)

        # Bottom: event log
        log_header = tk.Frame(self.schema_frame, bg=P["surface"], height=20)
        log_header.pack(fill="x")
        log_header.pack_propagate(False)
        tk.Label(log_header, text="EVENT LOG", font=F_PIXEL,
                 fg=P["cyan_dim"], bg=P["surface"]).pack(side="left", padx=6)

        self.schema_log = tk.Text(
            self.schema_frame, font=F_PIXEL, bg=P["obsidian"], fg=P["text_dim"],
            height=8, bd=0, padx=6, pady=4, state="disabled",
            highlightthickness=0, relief="flat", wrap="word",
            selectbackground=P["surface"]
        )
        self.schema_log.pack(fill="x")
        self.schema_log.tag_configure("ok", foreground=P["ok"])
        self.schema_log.tag_configure("err", foreground=P["err"])
        self.schema_log.tag_configure("warn", foreground=P["warn"])
        self.schema_log.tag_configure("info", foreground=P["cyan"])

        # Schema controls
        ctrl = tk.Frame(self.schema_frame, bg=P["void"], height=36)
        ctrl.pack(fill="x", side="bottom")
        ctrl.pack_propagate(False)

        bs = dict(font=F_SMALL, bg=P["surface"], fg=P["text"],
                  activebackground=P["hover"], activeforeground=P["cyan"],
                  bd=0, padx=10, pady=3, cursor="hand2")
        tk.Button(ctrl, text="Run: Success", command=lambda: self._run_scenario("success"), **bs).pack(side="left", padx=4, pady=4)
        tk.Button(ctrl, text="Run: Retry", command=lambda: self._run_scenario("retry"), **bs).pack(side="left", padx=4, pady=4)
        tk.Button(ctrl, text="Run: Hallucination", command=lambda: self._run_scenario("hallucination"), **bs).pack(side="left", padx=4, pady=4)
        tk.Button(ctrl, text="Reset", command=self._reset_schema, **bs).pack(side="left", padx=4, pady=4)

        self.schema_status = tk.Label(ctrl, text="click a scenario to simulate",
                                       font=F_SMALL, fg=P["text_dim"], bg=P["void"])
        self.schema_status.pack(side="right", padx=10)

        # Timeline canvas (hidden)
        self.timeline_frame = tk.Frame(self.center_frame, bg=P["void"])
        self.timeline_canvas = tk.Canvas(self.timeline_frame, bg=P["void"],
                                         highlightthickness=0, cursor="crosshair")
        self.timeline_canvas.pack(fill="both", expand=True)
        self.timeline_canvas.bind("<Button-1>", self._on_timeline_click)
        self.timeline_canvas.bind("<Configure>", lambda e: self._on_canvas_resize("timeline"))

        # Cards gallery canvas (hidden)
        self.cards_frame = tk.Frame(self.center_frame, bg=P["void"])
        self.cards_canvas = tk.Canvas(self.cards_frame, bg=P["void"],
                                      highlightthickness=0, cursor="hand2")
        self.cards_canvas.pack(fill="both", expand=True)
        self.cards_canvas.bind("<Button-1>", self._on_card_click)
        self.cards_canvas.bind("<Motion>", self._on_card_hover)
        self.cards_canvas.bind("<Leave>", self._on_card_leave)
        self.cards_canvas.bind("<Configure>", lambda e: self._on_canvas_resize("cards"))
        self._card_rects: dict[str, tuple[int, int, int, int]] = {}  # stem → (x,y,w,h)
        self._card_hover_stem: str | None = None  # currently hovered card

    # ─── RIGHT PANEL ─────────────────────────────────────────────
    def _build_right_panel(self):
        self.right_panel = tk.Frame(self.main_frame, bg=P["panel"], width=250)
        self.right_panel.grid(row=0, column=2, sticky="nsew", padx=(1, 2), pady=2)
        self.right_panel.grid_propagate(False)

        # Backlinks
        bl_canvas = tk.Canvas(self.right_panel, height=30, bg=P["surface"],
                              highlightthickness=0)
        bl_canvas.pack(fill="x")
        bl_canvas.create_text(10, 15, text="BACKLINKS", font=F_HEAD,
                              fill=P["cyan"], anchor="w")
        # Pixel art deco
        bl_deco = _load_icon("icon_graph", (18, 18))
        if bl_deco:
            self._bl_deco_img = bl_deco
            bl_canvas.create_image(232, 15, image=bl_deco)

        self.backlinks_listbox = tk.Listbox(
            self.right_panel, font=F_MONO, bg=P["panel"], fg=P["link"],
            selectbackground=P["surface"], selectforeground=P["cyan"],
            activestyle="none", bd=0, height=7,
            highlightthickness=0, relief="flat", cursor="hand2"
        )
        self.backlinks_listbox.pack(fill="x", padx=4, pady=4)
        self.backlinks_listbox.bind("<<ListboxSelect>>", self._on_backlink_select)

        # Outline
        ol_canvas = tk.Canvas(self.right_panel, height=24, bg=P["surface"],
                              highlightthickness=0)
        ol_canvas.pack(fill="x")
        ol_canvas.create_text(10, 12, text="OUTLINE", font=F_SMALL,
                              fill=P["amethyst"], anchor="w")

        self.outline_listbox = tk.Listbox(
            self.right_panel, font=F_SMALL, bg=P["panel"], fg=P["text"],
            selectbackground=P["surface"], selectforeground=P["cyan"],
            activestyle="none", bd=0,
            highlightthickness=0, relief="flat", cursor="hand2"
        )
        self.outline_listbox.pack(fill="both", expand=True, padx=4, pady=4)
        self.outline_listbox.bind("<<ListboxSelect>>", self._on_outline_select)

        # Outline reorder buttons
        ol_btn_f = tk.Frame(self.right_panel, bg=P["panel"])
        ol_btn_f.pack(fill="x", padx=4)
        tk.Button(ol_btn_f, text="\u25b2 Up", font=F_PIXEL,
                  fg=P["ice"], bg=P["surface"], activebackground=P["hover"],
                  bd=0, cursor="hand2",
                  command=self._reorder_heading_up).pack(side="left", padx=2)
        tk.Button(ol_btn_f, text="\u25bc Down", font=F_PIXEL,
                  fg=P["ice"], bg=P["surface"], activebackground=P["hover"],
                  bd=0, cursor="hand2",
                  command=self._reorder_heading_down).pack(side="left", padx=2)

        # Related Notes
        rn_canvas = tk.Canvas(self.right_panel, height=24, bg=P["surface"],
                              highlightthickness=0)
        rn_canvas.pack(fill="x")
        rn_canvas.create_text(10, 12, text="RELATED NOTES", font=F_SMALL,
                              fill=P["rose"], anchor="w")
        rn_deco = _load_icon("crystal_star", (14, 14))
        if rn_deco:
            self._rn_deco_img = rn_deco
            rn_canvas.create_image(200, 12, image=rn_deco)
        else:
            for i in range(3):
                rn_canvas.create_rectangle(198-i*6, 10, 202-i*6, 14,
                                           fill=P["rose"], outline="")

        self.related_listbox = tk.Listbox(
            self.right_panel, font=F_SMALL, bg=P["panel"], fg=P["text"],
            selectbackground=P["surface"], selectforeground=P["cyan"],
            activestyle="none", bd=0, height=4,
            highlightthickness=0, relief="flat", cursor="hand2"
        )
        self.related_listbox.pack(fill="x", padx=4, pady=4)
        self.related_listbox.bind("<<ListboxSelect>>", self._on_related_select)

        # Vault stats
        stats_canvas = tk.Canvas(self.right_panel, height=24, bg=P["surface"],
                                  highlightthickness=0)
        stats_canvas.pack(fill="x")
        stats_canvas.create_text(10, 12, text="VAULT STATS", font=F_SMALL,
                                  fill=P["emerald"], anchor="w")
        stats_deco = _load_icon("icon_goal", (14, 14))
        if stats_deco:
            self._stats_deco_img = stats_deco
            stats_canvas.create_image(200, 12, image=stats_deco)
        else:
            for i in range(4):
                stats_canvas.create_rectangle(198-i*6, 10, 202-i*6, 14,
                                               fill=P["cyan_dim"], outline="")

        self.stats_frame = tk.Frame(self.right_panel, bg=P["panel"])
        self.stats_frame.pack(fill="x", padx=4, pady=2)
        self.stat_labels: dict[str, tk.Label] = {}
        for key, label in [("notes", "Notes"), ("words", "Words"),
                           ("links", "Links"), ("tags", "Tags")]:
            row = tk.Frame(self.stats_frame, bg=P["panel"])
            row.pack(fill="x", pady=1)
            tk.Label(row, text=f"  {label}:", font=F_PIXEL,
                     fg=P["text_dim"], bg=P["panel"], anchor="w"
            ).pack(side="left")
            lbl = tk.Label(row, text="0", font=F_PIXEL,
                           fg=P["cyan"], bg=P["panel"], anchor="e")
            lbl.pack(side="right", padx=8)
            self.stat_labels[key] = lbl

        # Knowledge Score meter
        ks_canvas = tk.Canvas(self.right_panel, height=24, bg=P["surface"],
                              highlightthickness=0)
        ks_canvas.pack(fill="x")
        ks_canvas.create_text(10, 12, text="KNOWLEDGE SCORE", font=F_SMALL,
                              fill=P["ice"], anchor="w")
        ks_deco = _load_icon("icon_hive", (14, 14))
        if ks_deco:
            self._ks_deco_img = ks_deco
            ks_canvas.create_image(200, 12, image=ks_deco)
        self.ks_frame = tk.Frame(self.right_panel, bg=P["panel"])
        self.ks_frame.pack(fill="x", padx=4, pady=2)

        self.ks_bar_canvas = tk.Canvas(self.ks_frame, height=20, bg=P["panel"],
                                       highlightthickness=0)
        self.ks_bar_canvas.pack(fill="x", padx=4, pady=2)
        self.ks_score_label = tk.Label(self.ks_frame, text="0 / 100",
                                       font=F_PIXEL, fg=P["ice"], bg=P["panel"])
        self.ks_score_label.pack()
        self.ks_details_label = tk.Label(self.ks_frame, text="",
                                         font=F_PIXEL, fg=P["text_dim"],
                                         bg=P["panel"], wraplength=220)
        self.ks_details_label.pack()

        # Decorative honeycomb pixel art at bottom
        deco_img = _load_icon("deco_honeycomb", (24, 72))
        if deco_img:
            self._right_deco_img = deco_img
            deco_lbl = tk.Label(self.right_panel, image=deco_img, bg=P["panel"])
            deco_lbl.pack(side="bottom", pady=6)

    # ─── STATUS BAR ──────────────────────────────────────────────
    def _build_statusbar(self):
        bar = tk.Frame(self.root, bg=P["void"], height=22)
        bar.pack(fill="x", side="bottom")
        bar.pack_propagate(False)

        # Crystal star pixel art in statusbar
        star_ico = _load_icon("crystal_star", (16, 16))
        if star_ico:
            self._status_star = star_ico
            tk.Label(bar, image=star_ico, bg=P["void"]).pack(side="left", padx=(6, 2))

        self.status_left = tk.Label(bar, text="ready", font=F_PIXEL,
                                     fg=P["text_dim"], bg=P["void"])
        self.status_left.pack(side="left", padx=10)

        self.status_cursor = tk.Label(bar, text="Ln 1 Col 1", font=F_PIXEL,
                                       fg=P["text_dim"], bg=P["void"])
        self.status_cursor.pack(side="left", padx=6)

        self.status_right = tk.Label(bar, text="Ctrl+P: pipeline schema",
                                      font=F_PIXEL, fg=P["text_dim"], bg=P["void"])
        self.status_right.pack(side="right", padx=10)

        self.status_notes = tk.Label(bar, text="", font=F_PIXEL,
                                      fg=P["amethyst"], bg=P["void"])
        self.status_notes.pack(side="right", padx=10)

        self.status_mood = tk.Label(bar, text="", font=F_PIXEL,
                                    fg=P["ice"], bg=P["void"])
        self.status_mood.pack(side="right", padx=6)

        self.status_reading_time = tk.Label(bar, text="", font=F_PIXEL,
                                             fg=P["emerald"], bg=P["void"])
        self.status_reading_time.pack(side="right", padx=6)

        self.status_word_goal = tk.Label(bar, text="", font=F_PIXEL,
                                          fg=P["cyan_dim"], bg=P["void"])
        self.status_word_goal.pack(side="right", padx=6)

        self.status_pomodoro = tk.Label(bar, text="", font=F_PIXEL,
                                         fg=P["ember"], bg=P["void"],
                                         cursor="hand2")
        self.status_pomodoro.pack(side="right", padx=6)
        self.status_pomodoro.bind("<Button-1>", lambda e: self._show_pomodoro())

    # ─── FILE OPERATIONS ─────────────────────────────────────────
    def _refresh_file_tree(self):
        """Debounced file tree refresh — coalesces rapid calls within 150ms."""
        if self._file_tree_after_id:
            self.root.after_cancel(self._file_tree_after_id)
        self._file_tree_after_id = self.root.after(150, self._refresh_file_tree_now)

    def _refresh_file_tree_now(self):
        self._file_tree_after_id = None
        try:
            all_md = [p for p in self.vault_path.glob("**/*.md") if p.exists()]
        except OSError:
            all_md = []
        if self._sort_mode == "date":
            all_md.sort(key=lambda p: _safe_stat(p, "st_mtime", 0.0), reverse=True)
        elif self._sort_mode == "size":
            all_md.sort(key=lambda p: _safe_stat(p, "st_size", 0), reverse=True)
        else:
            all_md.sort(key=lambda p: p.name.lower())
        self._all_files = all_md
        self._filter_tree()
        self._refresh_tags()
        self._update_note_count()
        self._update_vault_stats()

    def _filter_tree(self):
        q = self.sidebar_search_var.get().lower()
        self.file_listbox.delete(0, "end")
        # Collect folders
        folders: set[str] = set()
        for fp in self._all_files:
            rel = fp.relative_to(self.vault_path)
            if len(rel.parts) > 1:
                folders.add(str(rel.parent))
        # Pinned notes first (root level)
        pinned = [fp for fp in self._all_files if fp.stem in self._pinned]
        for fp in pinned:
            name = fp.stem
            if q and q not in name.lower():
                continue
            self.file_listbox.insert("end", f"\u2605 {name}")
        # Build folder tree with expand/collapse
        sorted_folders = sorted(folders)
        shown_files: set[Path] = set(pinned)
        for folder in sorted_folders:
            folder_files = [fp for fp in self._all_files
                            if str(fp.relative_to(self.vault_path).parent) == folder
                            and fp not in shown_files]
            if q:
                folder_files = [fp for fp in folder_files if q in fp.stem.lower()]
            if not folder_files and q:
                continue
            is_expanded = folder in self._expanded_folders
            icon = "\u25BE" if is_expanded else "\u25B8"
            self.file_listbox.insert("end", f"{icon} \U0001f4c1 {folder}")
            if is_expanded:
                for fp in folder_files:
                    self.file_listbox.insert("end", f"    {fp.stem}")
                    shown_files.add(fp)
            else:
                shown_files.update(folder_files)
        # Root level files (not in folder, not pinned)
        for fp in self._all_files:
            if fp in shown_files:
                continue
            rel = fp.relative_to(self.vault_path)
            if len(rel.parts) > 1 and str(rel.parent) not in self._expanded_folders:
                continue
            name = fp.stem
            if q and q not in name.lower():
                continue
            self.file_listbox.insert("end", f"  {name}")

    def _refresh_tags(self):
        self.tag_listbox.delete(0, "end")
        tags: set[str] = set()
        for fp in self._all_files:
            content = self._read_cached(fp)
            tags.update(_RE_TAG_BARE.findall(content))
        for tag in sorted(tags):
            self.tag_listbox.insert("end", f"  #{tag}")
        self._draw_tag_cloud()

    def _update_note_count(self):
        self.status_notes.config(text=f"{len(self._all_files)} notes")

    def _on_listbox_hover(self, event, listbox):
        """Highlight listbox row under cursor."""
        idx = listbox.nearest(event.y)
        if idx < 0 or idx >= listbox.size():
            return
        prev = getattr(listbox, "_hover_idx", -1)
        if prev == idx:
            return
        if 0 <= prev < listbox.size():
            listbox.itemconfig(prev, bg=listbox.cget("bg"))
        listbox.itemconfig(idx, bg=P["hover"])
        listbox._hover_idx = idx

    def _on_listbox_leave(self, listbox):
        """Clear listbox hover highlight."""
        prev = getattr(listbox, "_hover_idx", -1)
        if 0 <= prev < listbox.size():
            listbox.itemconfig(prev, bg=listbox.cget("bg"))
        listbox._hover_idx = -1

    def _on_file_select(self, event):
        sel = self.file_listbox.curselection()
        if not sel:
            return
        text = self.file_listbox.get(sel[0]).strip()
        # Check if it's a folder row (expand/collapse)
        if "\U0001f4c1" in text:
            folder_name = text.split("\U0001f4c1")[-1].strip()
            if folder_name in self._expanded_folders:
                self._expanded_folders.discard(folder_name)
            else:
                self._expanded_folders.add(folder_name)
            self._filter_tree()
            return
        name = text.lstrip("\u2605").strip()
        for fp in self._all_files:
            if fp.stem == name:
                self._maybe_save_then(lambda: self._open_file(fp))
                return

    def _on_tag_select(self, event):
        sel = self.tag_listbox.curselection()
        if not sel:
            return
        tag = self.tag_listbox.get(sel[0]).strip().lstrip("#").strip()
        self.file_listbox.delete(0, "end")
        for fp in self._all_files:
            if f"#{tag}" in self._read_cached(fp):
                self.file_listbox.insert("end", f"  {fp.stem}")

    def _open_file(self, path: Path):
        try:
            content = path.read_text(encoding="utf-8")
        except Exception as exc:
            messagebox.showerror("Error", str(exc))
            return
        # Save current tab state before switching
        self._save_tab_state()
        # Check if file is already open in a tab
        for i, tab in enumerate(self._open_tabs):
            if tab["path"] == path:
                self._active_tab_idx = i
                self._load_tab(i)
                return
        # Open new tab
        tab_data = {"path": path, "content": content, "cursor": "1.0", "modified": False}
        self._open_tabs.append(tab_data)
        self._active_tab_idx = len(self._open_tabs) - 1
        self.current_file = path
        # Track recent files
        if path in self._recent_files:
            self._recent_files.remove(path)
        self._recent_files.insert(0, path)
        if len(self._recent_files) > 8:
            self._recent_files = self._recent_files[:8]
        self._refresh_recent_files()
        self.editor.delete("1.0", "end")
        self.editor.insert("1.0", content)
        self.editor.edit_modified(False)
        self.modified = False
        self._rebuild_tab_bar()
        self.status_left.config(text=f"opened: {path.stem}")
        self._apply_syntax()
        self._update_line_numbers()
        self._update_backlinks()
        self._update_outline()
        self._update_word_count()
        self._update_breadcrumb()
        self._schedule_tab_updates()
        if self.view_mode != "editor":
            self._show_editor()

    def _save_tab_state(self):
        """Save current editor content and cursor to the active tab."""
        if self._active_tab_idx >= 0 and self._active_tab_idx < len(self._open_tabs):
            tab = self._open_tabs[self._active_tab_idx]
            tab["content"] = self.editor.get("1.0", "end-1c")
            tab["cursor"] = self.editor.index("insert")
            tab["modified"] = self.modified

    def _load_tab(self, idx: int):
        """Load a tab's content into the editor."""
        if idx < 0 or idx >= len(self._open_tabs):
            return
        tab = self._open_tabs[idx]
        self._active_tab_idx = idx
        self.current_file = tab["path"]
        self.editor.delete("1.0", "end")
        self.editor.insert("1.0", tab["content"])
        try:
            self.editor.mark_set("insert", tab["cursor"])
            self.editor.see(tab["cursor"])
        except tk.TclError:
            self.editor.mark_set("insert", "1.0")
        self.editor.edit_modified(False)
        self.modified = tab["modified"]
        self._rebuild_tab_bar()
        self.status_left.config(text=f"tab: {tab['path'].stem}")
        self._apply_syntax()
        self._update_line_numbers()
        self._update_backlinks()
        self._update_outline()
        self._update_word_count()
        self._update_breadcrumb()
        self._schedule_tab_updates()
        if self.view_mode != "editor":
            self._show_editor()

    def _schedule_tab_updates(self):
        """Deduplicated deferred updates after tab switch/open."""
        for aid in self._tab_update_ids:
            self.root.after_cancel(aid)
        self._tab_update_ids = [
            self.root.after(100, self._update_minimap),
            self.root.after(150, self._update_related_notes),
            self.root.after(200, self._update_mood_indicator),
        ]

    def _rebuild_tab_bar(self):
        """Rebuild the tab bar widgets."""
        for w in self.tab_scroll_frame.winfo_children():
            w.destroy()
        if not self._open_tabs:
            tk.Label(self.tab_scroll_frame, text="No file open",
                     font=(FONT, 10), fg=P["text_dim"], bg=P["void"]
            ).pack(side="left", padx=10)
            return
        for i, tab in enumerate(self._open_tabs):
            is_active = (i == self._active_tab_idx)
            bg = P["panel"] if is_active else P["void"]
            fg = P["text_bright"] if is_active else P["text_dim"]
            tab_frame = tk.Frame(self.tab_scroll_frame, bg=bg)
            tab_frame.pack(side="left", padx=(0, 1))
            # Active tab accent line at bottom
            if is_active:
                accent = tk.Frame(tab_frame, bg=P["cyan"], height=2)
                accent.pack(fill="x", side="bottom")
            name = tab["path"].stem
            if tab["modified"]:
                name = "\u2022 " + name  # bullet dot for modified
            lbl = tk.Label(tab_frame, text=name, font=(FONT, 9),
                           fg=fg, bg=bg, padx=8, pady=3, cursor="hand2")
            lbl.pack(side="left")
            lbl.bind("<Button-1>", lambda e, idx=i: self._switch_tab(idx))
            lbl.bind("<B1-Motion>", lambda e, idx=i: self._on_tab_drag_start(e, idx))
            lbl.bind("<ButtonRelease-1>", lambda e, idx=i: self._on_tab_drop(e, idx))
            # Hover effect on tab label
            if not is_active:
                lbl.bind("<Enter>", lambda e, l=lbl: l.config(fg=P["text"], bg=P["surface"]))
                lbl.bind("<Leave>", lambda e, l=lbl: l.config(fg=P["text_dim"], bg=P["void"]))
            close_btn = tk.Label(tab_frame, text="\u00d7", font=(FONT, 9),
                                 fg=P["text_dim"], bg=bg, padx=2, cursor="hand2")
            close_btn.pack(side="left")
            close_btn.bind("<Button-1>", lambda e, idx=i: self._close_tab(idx))
            close_btn.bind("<Enter>", lambda e, cb=close_btn: cb.config(fg=P["rose"]))
            close_btn.bind("<Leave>", lambda e, cb=close_btn, b=bg: cb.config(fg=P["text_dim"]))

    def _switch_tab(self, idx: int):
        """Switch to a different tab."""
        if idx == self._active_tab_idx:
            return
        self._save_tab_state()
        self._load_tab(idx)

    def _close_tab(self, idx: int):
        """Close a tab by index."""
        if idx < 0 or idx >= len(self._open_tabs):
            return
        tab = self._open_tabs[idx]
        if tab["modified"]:
            ans = messagebox.askyesnocancel("Save?", f"Save '{tab['path'].stem}'?")
            if ans is None:
                return
            if ans:
                try:
                    tab["path"].write_text(tab["content"], encoding="utf-8")
                except OSError as e:
                    messagebox.showerror("Save Error", f"Cannot save:\n{e}")
                    return
        self._open_tabs.pop(idx)
        if not self._open_tabs:
            self._active_tab_idx = -1
            self.current_file = None
            self.editor.delete("1.0", "end")
            self.modified = False
            self._rebuild_tab_bar()
            return
        if idx <= self._active_tab_idx:
            self._active_tab_idx = max(0, self._active_tab_idx - 1)
        self._load_tab(self._active_tab_idx)

    def _close_active_tab(self):
        """Close the currently active tab (Ctrl+W)."""
        if self._active_tab_idx >= 0:
            self._save_tab_state()
            self._close_tab(self._active_tab_idx)

    def _cycle_tab(self, direction: int = 1):
        """Cycle through open tabs. direction=1 forward, -1 backward."""
        if len(self._open_tabs) < 2:
            return
        self._save_tab_state()
        self._active_tab_idx = (self._active_tab_idx + direction) % len(self._open_tabs)
        self._load_tab(self._active_tab_idx)

    # ─── TOAST NOTIFICATIONS ────────────────────────────────────────
    def _show_toast(self, message: str, duration_ms: int = 3000):
        """Show a non-blocking auto-dismissing toast overlay."""
        if self._toast_after_id is not None:
            self.root.after_cancel(self._toast_after_id)
            self._toast_after_id = None
        self._toast_label.config(text=message)
        self._toast_label.place(relx=0.5, rely=0.0, anchor="n", y=8)
        self._toast_label.lift()
        self._toast_after_id = self.root.after(duration_ms, self._hide_toast)

    def _hide_toast(self):
        """Hide the toast overlay."""
        self._toast_label.place_forget()
        self._toast_after_id = None

    # ─── TASK HISTORY EXPORT ────────────────────────────────────────
    def _export_task_history(self):
        """Export task history as JSON file (Ctrl+Shift+X)."""
        history_path = self.vault_path / "Hive Reports" / "task_history.json"
        if not history_path.exists():
            self._show_toast("No task history to export.")
            return
        try:
            raw = history_path.read_text(encoding="utf-8")
            history = json.loads(raw) if raw.strip() else []
        except Exception:
            self._show_toast("Failed to read task history.")
            return
        if not history:
            self._show_toast("Task history is empty.")
            return
        save_path = filedialog.asksaveasfilename(
            defaultextension=".json",
            filetypes=[("JSON", "*.json"), ("All", "*.*")],
            initialfile="task_history_export.json",
            title="Export Task History",
        )
        if not save_path:
            return
        try:
            Path(save_path).write_text(
                json.dumps(history, indent=2, ensure_ascii=False), encoding="utf-8"
            )
            self._show_toast(f"Exported {len(history)} tasks to {Path(save_path).name}")
        except OSError as e:
            self._show_toast(f"Export failed: {e}")

    # ─── BREADCRUMB ──────────────────────────────────────────────
    def _update_breadcrumb(self):
        """Update breadcrumb path display for current file."""
        if not self.current_file:
            self.breadcrumb_label.config(text="vault")
            return
        try:
            rel = self.current_file.relative_to(self.vault_path)
            parts = list(rel.parts)
            crumbs = ["vault"]
            for part in parts[:-1]:
                crumbs.append(part)
            crumbs.append(rel.stem)
            if self._split_active and self._split_file and self._split_file != self.current_file:
                try:
                    split_rel = self._split_file.relative_to(self.vault_path)
                    split_text = split_rel.stem
                except ValueError:
                    split_text = self._split_file.stem
                crumbs.append(f"split: {split_text}")
            self.breadcrumb_label.config(
                text="  \u203a  ".join(crumbs),
                fg=P["text_dim"]
            )
        except ValueError:
            self.breadcrumb_label.config(text=self.current_file.stem)

    # ─── SPLIT VIEW ──────────────────────────────────────────────
    def _toggle_split_view(self):
        """Toggle side-by-side split editor view."""
        if self._split_active:
            self._close_split_view()
        else:
            self._open_split_view()

    def _open_split_view(self):
        """Open split view with a file chooser."""
        if not self._open_tabs:
            return
        # Show list of open files to pick from
        files = [tab["path"] for tab in self._open_tabs
                 if tab["path"] != self.current_file]
        if not files:
            # Open the same file in split
            files = [self.current_file] if self.current_file else []
        if not files:
            return
        # If only one option, just open it
        if len(files) == 1:
            self._show_split(files[0])
            return
        # Show picker
        picker = tk.Toplevel(self.root)
        picker.title("Split View — Choose File")
        picker.geometry("320x250")
        picker.configure(bg=P["panel"])
        self._prepare_modal(picker)
        tk.Label(picker, text="Open in split view:", font=F_HEAD,
                 fg=P["heading"], bg=P["panel"]).pack(pady=(10, 5))
        lb = tk.Listbox(picker, font=F_MONO, bg=P["surface"], fg=P["text"],
                        selectbackground=P["hover"], selectforeground=P["cyan"],
                        bd=0, highlightthickness=1, highlightcolor=P["cyan"],
                        highlightbackground=P["border"])
        lb.pack(fill="both", expand=True, padx=10, pady=5)
        for fp in files:
            lb.insert("end", f"  {fp.stem}")
        def on_pick(event=None):
            sel = lb.curselection()
            if sel:
                fp = files[sel[0]]
                self._show_split(fp)
            picker.destroy()
        lb.bind("<Double-1>", on_pick)
        tk.Button(picker, text="Open", font=F_SMALL, bg=P["surface"],
                  fg=P["text"], activebackground=P["hover"], bd=0,
                  padx=12, pady=4, cursor="hand2", command=on_pick
        ).pack(pady=(0, 10))

    def _show_split(self, path: Path):
        """Show a file in the split pane."""
        try:
            content = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            # Try to get from open tabs
            for tab in self._open_tabs:
                if tab["path"] == path:
                    content = tab["content"]
                    break
            else:
                return
        self._split_active = True
        self._split_file = path
        self.split_label.config(text=f"SPLIT \u2014 {path.stem}")
        self.split_editor.delete("1.0", "end")
        self.split_editor.insert("1.0", content)
        self._update_breadcrumb()
        # Resize main editor to half, show split
        self.editor_container.pack_forget()
        self.split_container.pack_forget()
        self.editor_container.pack(fill="both", expand=True, padx=4, pady=(4, 1), side="top")
        self.split_container.pack(fill="both", expand=True, padx=4, pady=(1, 4), side="top")

    def _close_split_view(self):
        """Close the split editor pane."""
        self._split_active = False
        self._split_file = None
        self._update_breadcrumb()
        self.split_container.pack_forget()
        if self.view_mode == "editor":
            self.editor_container.pack_forget()
            self.editor_container.pack(fill="both", expand=True, padx=4, pady=4)

    # ─── DRAG & DROP TABS ────────────────────────────────────────
    def _on_tab_drag_start(self, event, idx):
        """Start dragging a tab."""
        self._tab_drag_idx = idx

    def _on_tab_drag_motion(self, event, idx):
        """Visual feedback during tab drag."""
        if self._tab_drag_idx is None:
            return

    def _on_tab_drop(self, event, idx):
        """Drop tab at new position."""
        src = self._tab_drag_idx
        self._tab_drag_idx = None
        if src is None or src == idx:
            return
        if src < 0 or src >= len(self._open_tabs):
            return
        if idx < 0 or idx >= len(self._open_tabs):
            return
        # Move the tab
        tab = self._open_tabs.pop(src)
        self._open_tabs.insert(idx, tab)
        # Update active index
        if self._active_tab_idx == src:
            self._active_tab_idx = idx
        elif src < self._active_tab_idx <= idx:
            self._active_tab_idx -= 1
        elif idx <= self._active_tab_idx < src:
            self._active_tab_idx += 1
        self._rebuild_tab_bar()

    # ─── WORD GOAL ───────────────────────────────────────────────
    def _set_word_goal(self):
        """Set a word count goal for current note."""
        current = self._word_goal if self._word_goal > 0 else ""
        val = simpledialog.askstring("Word Goal",
                                     f"Set word count goal (0 to clear):\nCurrent: {current}",
                                     parent=self.root)
        if val is None:
            return
        try:
            goal = int(val)
            self._word_goal = max(0, goal)
        except ValueError:
            self._word_goal = 0
        self._update_word_count()

    def _new_folder(self):
        """Create a new folder in the vault."""
        name = simpledialog.askstring("New Folder", "Folder name:", parent=self.root)
        if not name:
            return
        if not re.match(r'^[\w\-. ]+$', name) or ".." in name or Path(name).name != name:
            messagebox.showwarning("Invalid Name", "Folder name contains invalid characters.")
            return
        folder_path = self.vault_path / name
        if folder_path.exists():
            messagebox.showwarning("Exists", f"Folder '{name}' already exists")
            return
        try:
            folder_path.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            messagebox.showerror("Error", f"Cannot create folder:\n{e}")
            return
        self._expanded_folders.add(name)
        self._refresh_file_tree()
        self.status_left.config(text=f"created folder: {name}")

    def _show_command_palette(self):
        """Show a VS Code-style command palette with fuzzy search."""
        commands = [
            ("New Note", self._new_note),
            ("New Folder", self._new_folder),
            ("Save Note", self._save_note),
            ("Delete Note", self._delete_note),
            ("Rename Note", self._rename_note),
            ("Close Tab", self._close_active_tab),
            ("Toggle Search", self._toggle_search),
            ("Vault Search", self._toggle_vault_search),
            ("Editor View", self._show_editor),
            ("Preview View", self._show_preview),
            ("Graph View", self._show_graph),
            ("Pipeline Schema", self._show_schema),
            ("Hive AI View", self._show_hive),
            ("Timeline View", self._show_timeline),
            ("Export HTML", self._export_html),
            ("AI Command Palette", self._show_ai_palette),
            ("Pin/Unpin Note", self._toggle_pin),
            ("Take Snapshot", self._take_snapshot),
            ("View Snapshots", self._show_snapshots),
            ("Focus Mode", self._toggle_focus_mode),
            ("Zoom In", self._zoom_in),
            ("Zoom Out", self._zoom_out),
            ("Zoom Reset", self._zoom_reset),
            ("Sort by Name", lambda: self._set_sort("name")),
            ("Sort by Date", lambda: self._set_sort("date")),
            ("Sort by Size", lambda: self._set_sort("size")),
            ("Keyboard Shortcuts", self._show_shortcuts),
            ("Daily Note", self._new_daily_note),
            ("Split View", self._toggle_split_view),
            ("Set Word Goal", self._set_word_goal),
            ("Cards Gallery", self._show_cards),
            ("Quick Switcher", self._show_quick_switcher),
            ("View Trash", self._show_trash),
            ("Insert Table", self._insert_table),
            ("Writing Statistics", self._show_writing_stats),
            ("Toggle Bookmark", self._toggle_bookmark),
            ("View Bookmarks", self._show_bookmarks),
            ("Pomodoro Timer", self._show_pomodoro),
            ("Note Diff Viewer", self._show_diff_viewer),
            ("Sticky Board", self._show_sticky_board),
            ("Random Note", self._open_random_note),
            ("Word Cloud", self._show_word_cloud),
            ("Note Templates", self._show_templates),
            ("Vault Changelog", self._show_vault_changelog),
            ("Move Heading Up", self._reorder_heading_up),
            ("Move Heading Down", self._reorder_heading_down),
        ]

        win = tk.Toplevel(self.root)
        win.overrideredirect(True)
        win.configure(bg=P["border_glow"])
        # Center on screen
        rw, rh = 420, 360
        rx = max(0, self.root.winfo_x() + (self.root.winfo_width() - rw) // 2)
        ry = max(0, self.root.winfo_y() + 80)
        win.geometry(f"{rw}x{rh}+{rx}+{ry}")
        self._prepare_modal(win)

        inner = tk.Frame(win, bg=P["surface"], padx=2, pady=2)
        inner.pack(fill="both", expand=True, padx=1, pady=1)

        # Search entry
        search_var = tk.StringVar()
        entry = tk.Entry(inner, textvariable=search_var,
                         font=F_MONO, bg=P["panel"], fg=P["text"],
                         insertbackground=P["cyan"], bd=0,
                         highlightthickness=2, highlightcolor=P["cyan"],
                         highlightbackground=P["border"])
        entry.pack(fill="x", padx=6, pady=(8, 4))
        entry.focus_set()

        # Results listbox
        results_lb = tk.Listbox(inner, font=F_MONO, bg=P["panel"], fg=P["text"],
                                selectbackground=P["hover"], selectforeground=P["cyan"],
                                activestyle="none", bd=0, highlightthickness=0,
                                relief="flat", cursor="hand2")
        results_lb.pack(fill="both", expand=True, padx=6, pady=(2, 8))

        filtered: list[tuple[str, object]] = list(commands)

        def refresh_list(*_):
            q = search_var.get().lower()
            results_lb.delete(0, "end")
            filtered.clear()
            for name, cmd in commands:
                if q and q not in name.lower():
                    continue
                filtered.append((name, cmd))
                results_lb.insert("end", f"  {name}")
            if filtered:
                results_lb.selection_set(0)

        def execute_selected(*_):
            sel = results_lb.curselection()
            if sel and sel[0] < len(filtered):
                _, cmd = filtered[sel[0]]
                win.destroy()
                cmd()
            else:
                win.destroy()

        def on_key(event):
            if event.keysym == "Escape":
                win.destroy()
            elif event.keysym == "Return":
                execute_selected()
            elif event.keysym == "Down":
                cur = results_lb.curselection()
                idx = (cur[0] + 1) if cur else 0
                if idx < results_lb.size():
                    results_lb.selection_clear(0, "end")
                    results_lb.selection_set(idx)
                    results_lb.see(idx)
            elif event.keysym == "Up":
                cur = results_lb.curselection()
                idx = (cur[0] - 1) if cur else 0
                if idx >= 0:
                    results_lb.selection_clear(0, "end")
                    results_lb.selection_set(idx)
                    results_lb.see(idx)

        search_var.trace_add("write", refresh_list)
        entry.bind("<KeyPress>", on_key)
        results_lb.bind("<Double-Button-1>", execute_selected)
        win.bind("<Escape>", lambda e: win.destroy())
        win.bind("<FocusOut>", lambda e: win.destroy() if e.widget == win else None)
        refresh_list()

    def _save_note(self):
        if not self.current_file:
            return
        content = self.editor.get("1.0", "end-1c")
        try:
            self.current_file.write_text(content, encoding="utf-8")
            self.editor.edit_modified(False)
            self.modified = False
            # Update tab state
            if self._active_tab_idx >= 0 and self._active_tab_idx < len(self._open_tabs):
                self._open_tabs[self._active_tab_idx]["modified"] = False
                self._open_tabs[self._active_tab_idx]["content"] = content
                self._rebuild_tab_bar()
            self.status_left.config(text=f"saved: {self.current_file.stem}")
            self._show_toast(f"Saved: {self.current_file.stem}")
            self._invalidate_cache(self.current_file)
            self._importance_cache.clear()
            self._rebuild_graph_data()
            self._refresh_file_tree()
            self._update_backlinks()
            self._ai_on_save_analysis()
        except Exception as exc:
            messagebox.showerror("Error", str(exc))

    def _new_note(self):
        # Note template selection
        _TEMPLATES = {
            "Blank": "# {name}\n\n",
            "Meeting": "# {name}\n\n## Attendees\n\n- \n\n## Agenda\n\n1. \n\n## Notes\n\n\n\n## Action Items\n\n- [ ] \n",
            "Daily": "# {name}\n\n## Tasks\n\n- [ ] \n\n## Notes\n\n\n\n## Reflections\n\n",
            "Project": "# {name}\n\n## Goal\n\n\n\n## Tasks\n\n- [ ] \n\n## Resources\n\n- \n\n## Timeline\n\n| Date | Milestone |\n|------|-----------|\n|      |           |\n",
        }
        win = tk.Toplevel(self.root)
        win.title("New Note")
        win.geometry("320x260")
        win.configure(bg=P["panel"])
        self._prepare_modal(win)
        tk.Label(win, text="NOTE NAME", font=F_SMALL,
                 fg=P["heading"], bg=P["panel"]).pack(pady=(12, 4))
        name_var = tk.StringVar()
        entry = tk.Entry(win, textvariable=name_var, font=F_SMALL,
                         bg=P["surface"], fg=P["text"],
                         insertbackground=P["cyan"], bd=1, relief="solid")
        entry.pack(fill="x", padx=20, pady=(0, 8))
        entry.focus_set()
        tk.Label(win, text="TEMPLATE", font=F_SMALL,
                 fg=P["heading"], bg=P["panel"]).pack(pady=(4, 4))
        tpl_var = tk.StringVar(value="Blank")
        tpl_frame = tk.Frame(win, bg=P["panel"])
        tpl_frame.pack(fill="x", padx=20)
        for tpl_name in _TEMPLATES:
            tk.Radiobutton(tpl_frame, text=tpl_name, variable=tpl_var,
                           value=tpl_name, font=F_PIXEL,
                           fg=P["text"], bg=P["panel"],
                           selectcolor=P["surface"],
                           activebackground=P["panel"],
                           activeforeground=P["cyan"]
                           ).pack(side="left", padx=4)

        def _do_create():
            name = name_var.get().strip()
            if not name:
                return
            if not name.endswith(".md"):
                name += ".md"
            if not _is_safe_note_name(name):
                messagebox.showwarning("Invalid", "Name cannot contain path separators or '..'")
                return
            path = self.vault_path / name
            if path.exists():
                messagebox.showwarning("exists", f"'{name}' already exists")
                return
            tpl = _TEMPLATES.get(tpl_var.get(), _TEMPLATES["Blank"])
            content = tpl.replace("{name}", Path(name).stem)
            try:
                path.write_text(content, encoding="utf-8")
            except OSError as e:
                messagebox.showerror("Error", f"Cannot create note:\n{e}")
                return
            self._importance_cache.clear()
            self._refresh_file_tree()
            self._rebuild_graph_data()
            self._open_file(path)
            self._show_toast(f"Created: {Path(name).stem} ({tpl_var.get()})")
            win.destroy()

        entry.bind("<Return>", lambda e: _do_create())
        btn_frame = tk.Frame(win, bg=P["panel"])
        btn_frame.pack(pady=12)
        tk.Button(btn_frame, text="Create", font=F_SMALL,
                  fg=P["cyan"], bg=P["surface"],
                  activebackground=P["hover"], bd=0, padx=12, pady=4,
                  cursor="hand2", command=_do_create
                  ).pack(side="left", padx=6)
        tk.Button(btn_frame, text="Cancel", font=F_SMALL,
                  fg=P["text_dim"], bg=P["surface"],
                  activebackground=P["hover"], bd=0, padx=12, pady=4,
                  cursor="hand2", command=win.destroy
                  ).pack(side="left", padx=6)

    def _delete_note(self):
        if not self.current_file or not self.current_file.exists():
            return
        name = self.current_file.stem
        if not messagebox.askyesno("Move to Trash?", f"Move '{name}' to trash?\nYou can restore it later."):
            return
        try:
            # Move to .trash instead of permanent delete
            trash_dest = self._trash_path / self.current_file.name
            if trash_dest.exists():
                trash_dest = self._trash_path / f"{self.current_file.stem}_{int(time.time())}.md"
            import shutil
            shutil.move(str(self.current_file), str(trash_dest))
            # Remove from tabs without save prompt
            for i, tab in enumerate(self._open_tabs):
                if tab["path"] == self.current_file:
                    self._open_tabs.pop(i)
                    if not self._open_tabs:
                        self._active_tab_idx = -1
                        self.current_file = None
                        self.modified = False
                        self.editor.delete("1.0", "end")
                        self._rebuild_tab_bar()
                    else:
                        self._active_tab_idx = max(0, min(self._active_tab_idx, len(self._open_tabs) - 1))
                        self._load_tab(self._active_tab_idx)
                    break
            else:
                self.current_file = None
                self.modified = False
                self.editor.delete("1.0", "end")
                self._rebuild_tab_bar()
            self.status_left.config(text=f"trashed: {name} (restorable)")
            self._invalidate_cache()
            self._importance_cache.clear()
            self._refresh_file_tree()
            self._rebuild_graph_data()
            self._update_backlinks()
            self._update_outline()
            self._update_vault_stats()
        except Exception as exc:
            messagebox.showerror("Error", str(exc))

    def _rename_note(self):
        if not self.current_file or not self.current_file.exists():
            return
        old_name = self.current_file.stem
        new_name = simpledialog.askstring("Rename", f"Rename '{old_name}' to:",
                                           parent=self.root)
        if not new_name:
            return
        if not new_name.endswith(".md"):
            new_name += ".md"
        if not _is_safe_note_name(new_name):
            messagebox.showwarning("Invalid", "Name cannot contain path separators or '..'")
            return
        new_path = self.vault_path / new_name
        if new_path.exists():
            messagebox.showwarning("exists", f"'{new_name}' already exists")
            return
        try:
            old_stem = self.current_file.stem
            self.current_file.rename(new_path)
            # Update tab data
            for tab in self._open_tabs:
                if tab["path"] == self.current_file:
                    tab["path"] = new_path
                    break
            self.current_file = new_path
            self._rebuild_tab_bar()
            # Update wikilinks in all vault files
            new_stem = new_path.stem
            link_pat = re.compile(r'\[\[' + re.escape(old_stem) + r'(\|[^\]]+)?\]\]')
            for fp in self.vault_path.glob("**/*.md"):
                if fp == new_path:
                    continue
                try:
                    content = fp.read_text(encoding="utf-8")
                    updated = link_pat.sub(lambda m: f'[[{new_stem}{m.group(1) or ""}]]', content)
                    if updated != content:
                        fp.write_text(updated, encoding="utf-8")
                        self._invalidate_cache(fp)
                except Exception:
                    pass
            self.status_left.config(text=f"renamed: {old_stem} -> {new_stem}")
            self._importance_cache.clear()
            self._invalidate_cache()
            self._refresh_file_tree()
            self._rebuild_graph_data()
            self._update_backlinks()
        except Exception as exc:
            messagebox.showerror("Error", str(exc))

    def _on_file_right_click(self, event):
        idx = self.file_listbox.nearest(event.y)
        if idx >= 0:
            self.file_listbox.selection_clear(0, "end")
            self.file_listbox.selection_set(idx)
            self._on_file_select(event)
        self.file_ctx_menu.tk_popup(event.x_root, event.y_root)

    def _ctx_open(self):
        sel = self.file_listbox.curselection()
        if sel:
            self._on_file_select(None)

    def _new_daily_note(self):
        today = datetime.date.today().isoformat()
        name = f"{today}.md"
        path = self.vault_path / name
        if path.exists():
            self._open_file(path)
            return
        content = f"# {today}\n\n## Tasks\n\n- [ ] \n\n## Notes\n\n\n\n## Log\n\n> started at {datetime.datetime.now().strftime('%H:%M')}\n"
        try:
            path.write_text(content, encoding="utf-8")
        except OSError as e:
            messagebox.showerror("Error", f"Cannot create daily note:\n{e}")
            return
        self._importance_cache.clear()
        self._refresh_file_tree()
        self._rebuild_graph_data()
        self._open_file(path)

    def _new_from_template(self, template_name: str):
        templates = {
            "Meeting Notes": "# Meeting: {name}\n\n**Date:** {date}\n**Attendees:** \n\n## Agenda\n\n1. \n\n## Discussion\n\n\n\n## Action Items\n\n- [ ] \n",
            "Project Idea": "# Project: {name}\n\n## Overview\n\n\n\n## Goals\n\n- \n\n## Tech Stack\n\n- \n\n## Timeline\n\n| Phase | Target |\n|-------|--------|\n| MVP   |        |\n\n## References\n\n",
            "Character Sheet": "# {name}\n\n## Stats\n\n| Stat | Value |\n|------|-------|\n| HP   |       |\n| ATK  |       |\n| DEF  |       |\n| SPD  |       |\n\n## Backstory\n\n\n\n## Abilities\n\n- \n\n## Notes\n\n#character\n",
            "Bug Report": "# Bug: {name}\n\n**Severity:** \n**Status:** open\n\n## Description\n\n\n\n## Steps to Reproduce\n\n1. \n\n## Expected Behavior\n\n\n\n## Actual Behavior\n\n\n\n## Environment\n\n#bug\n",
        }
        tmpl = templates.get(template_name, "# {name}\n\n")
        name = simpledialog.askstring("New from Template",
                                       f"{template_name} — note name:", parent=self.root)
        if not name:
            return
        fname = name if name.endswith(".md") else name + ".md"
        if not _is_safe_note_name(fname):
            messagebox.showwarning("Invalid", "Name cannot contain path separators or '..'")
            return
        path = self.vault_path / fname
        if path.exists():
            messagebox.showwarning("exists", f"'{fname}' already exists")
            return
        today = datetime.date.today().isoformat()
        content = tmpl.replace("{name}", Path(fname).stem).replace("{date}", today)
        try:
            path.write_text(content, encoding="utf-8")
        except OSError as e:
            messagebox.showerror("Error", f"Cannot create note:\n{e}")
            return
        self._importance_cache.clear()
        self._refresh_file_tree()
        self._rebuild_graph_data()
        self._open_file(path)

    def _set_sort(self, mode: str):
        self._sort_mode = mode
        self._refresh_file_tree()
        self.status_left.config(text=f"sorted by {mode}")

    def _toggle_pin(self):
        if not self.current_file:
            return
        stem = self.current_file.stem
        if stem in self._pinned:
            self._pinned.discard(stem)
            self.status_left.config(text=f"unpinned: {stem}")
        else:
            self._pinned.add(stem)
            self.status_left.config(text=f"\u2605 pinned: {stem}")
        self._filter_tree()

    def _toggle_vault_search(self):
        self._vault_search_visible = not self._vault_search_visible
        if self._vault_search_visible:
            self.vault_search_bar.pack(fill="x", padx=4, pady=2, before=self.tag_listbox)
            self.vault_search_entry.focus_set()
        else:
            self.vault_search_bar.pack_forget()
            self.vault_search_results.pack_forget()
            self.vault_search_results.config(height=0)

    def _do_vault_search(self):
        q = self.vault_search_var.get().strip().lower()
        if not q:
            return
        self.vault_search_results.delete(0, "end")
        results = []
        for fp in self._all_files:
            content = self._read_cached(fp)
            lines = content.split("\n")
            for i, line in enumerate(lines):
                if q in line.lower():
                    preview = line.strip()[:50]
                    results.append((fp, i + 1, preview))
                    if len(results) >= 40:
                        break
            if len(results) >= 40:
                break
        if results:
            self.vault_search_results.pack(fill="x", padx=4, pady=2, before=self.tag_listbox)
            self.vault_search_results.config(height=min(8, len(results)))
            self._vault_search_data = results
            for fp, line_no, preview in results:
                self.vault_search_results.insert("end", f"{fp.stem}:{line_no} {preview}")
            self.status_left.config(text=f"vault: {len(results)} matches")
        else:
            self.vault_search_results.pack_forget()
            self.status_left.config(text="vault: no matches")

    def _on_vault_search_select(self, event):
        sel = self.vault_search_results.curselection()
        if not sel or not hasattr(self, '_vault_search_data'):
            return
        if sel[0] >= len(self._vault_search_data):
            return
        fp, line_no, _ = self._vault_search_data[sel[0]]
        if fp.exists():
            self._maybe_save_then(lambda: self._open_file_at_line(fp, line_no))

    def _open_file_at_line(self, path: Path, line: int):
        self._open_file(path)
        self.editor.see(f"{line}.0")
        self.editor.mark_set("insert", f"{line}.0")
        # Highlight vault-search query in opened file
        if hasattr(self, 'vault_search_var'):
            q = self.vault_search_var.get().strip()
            if q:
                self.editor.tag_remove("search_match", "1.0", "end")
                line_text = self.editor.get(f"{line}.0", f"{line}.end")
                pos_in_line = line_text.lower().find(q.lower())
                if pos_in_line >= 0:
                    start = f"{line}.{pos_in_line}"
                    end = f"{line}.{pos_in_line + len(q)}"
                    self.editor.tag_add("search_match", start, end)

    # ─── GRAPH LAYOUT ────────────────────────────────────────────
    def _set_graph_layout(self, mode: str):
        """Switch graph layout mode and redraw."""
        self._graph_layout_mode = mode
        self._graph_custom_positions.clear()
        for m, btn in self._layout_buttons.items():
            btn.config(fg=P["cyan"] if m == mode else P["text"])
        self._draw_graph()
        self._show_toast(f"Layout: {mode}")

    # ─── BOOKMARKS ───────────────────────────────────────────────
    def _toggle_bookmark(self):
        """Toggle bookmark on current editor line."""
        if not self.current_file:
            return
        stem = self.current_file.stem
        idx = self.editor.index("insert")
        line_no = int(idx.split(".")[0])
        bm_list = self._bookmarks.setdefault(stem, [])
        if line_no in bm_list:
            bm_list.remove(line_no)
            self._show_toast(f"Bookmark removed: L{line_no}")
        else:
            bm_list.append(line_no)
            bm_list.sort()
            self._show_toast(f"Bookmark set: L{line_no}")
        self._refresh_bookmark_list()

    def _refresh_bookmark_list(self):
        """Refresh sidebar bookmark listbox."""
        self.bookmark_listbox.delete(0, "end")
        for stem, lines in sorted(self._bookmarks.items()):
            for ln in lines:
                self.bookmark_listbox.insert("end", f"{stem}:L{ln}")

    def _on_bookmark_select(self, event):
        """Jump to selected bookmark."""
        sel = self.bookmark_listbox.curselection()
        if not sel:
            return
        text = self.bookmark_listbox.get(sel[0])
        if ":L" not in text:
            return
        stem, line_str = text.rsplit(":L", 1)
        line_no = int(line_str)
        # Find matching file
        for fp in self._all_files:
            if fp.stem == stem:
                self._maybe_save_then(lambda p=fp, ln=line_no: self._open_file_at_line(p, ln))
                break

    def _export_html(self):
        if not self.current_file:
            messagebox.showinfo("Export", "No note open to export.")
            return
        content = self.editor.get("1.0", "end-1c")
        title = self.current_file.stem
        html_lines = [
            "<!DOCTYPE html>",
            '<html lang="en"><head><meta charset="utf-8">',
            f"<title>{self._escape_html(title)}</title>",
            "<style>",
            f"body {{ background: {P['obsidian']}; color: {P['text']}; font-family: Consolas, monospace; padding: 40px; max-width: 800px; margin: 0 auto; }}",
            f"h1 {{ color: {P['heading']}; border-bottom: 1px solid {P['border']}; padding-bottom: 8px; }}",
            f"h2 {{ color: {P['heading']}; }}",
            f"h3 {{ color: {P['amethyst']}; }}",
            f"a {{ color: {P['link']}; }}",
            f"code {{ background: {P['surface']}; color: {P['code_fg']}; padding: 2px 6px; border-radius: 3px; }}",
            f"blockquote {{ border-left: 3px solid {P['amethyst_dim']}; padding-left: 12px; color: {P['text_dim']}; font-style: italic; }}",
            f"hr {{ border: none; border-top: 1px solid {P['border_glow']}; }}",
            f".tag {{ color: {P['tag']}; }}",
            f".task-done {{ color: {P['ok']}; text-decoration: line-through; }}",
            f".task-open {{ color: {P['rose']}; }}",
            "</style></head><body>",
        ]
        for line in content.split("\n"):
            if line.startswith("### "):
                html_lines.append(f"<h3>{self._escape_html(line[4:])}</h3>")
            elif line.startswith("## "):
                html_lines.append(f"<h2>{self._escape_html(line[3:])}</h2>")
            elif line.startswith("# "):
                html_lines.append(f"<h1>{self._escape_html(line[2:])}</h1>")
            elif line.startswith("> "):
                html_lines.append(f"<blockquote>{self._escape_html(line[2:])}</blockquote>")
            elif re.match(r'^-{3,}$', line.strip()):
                html_lines.append("<hr>")
            elif re.match(r'^\s*- \[x\]\s', line):
                text = re.sub(r'^\s*- \[x\]\s*', '', line)
                html_lines.append(f'<p class="task-done">\u2611 {self._escape_html(text)}</p>')
            elif re.match(r'^\s*- \[ \]\s', line):
                text = re.sub(r'^\s*- \[ \]\s*', '', line)
                html_lines.append(f'<p class="task-open">\u2610 {self._escape_html(text)}</p>')
            elif re.match(r'^\s*[-*]\s', line):
                text = re.sub(r'^\s*[-*]\s', '', line)
                html_lines.append(f"<li>{self._inline_html(text)}</li>")
            elif line.strip():
                html_lines.append(f"<p>{self._inline_html(line)}</p>")
            else:
                html_lines.append("<br>")
        html_lines.append("</body></html>")
        html_content = "\n".join(html_lines)

        save_path = filedialog.asksaveasfilename(
            defaultextension=".html",
            filetypes=[("HTML files", "*.html")],
            initialfile=f"{title}.html",
            title="Export as HTML"
        )
        if save_path:
            try:
                Path(save_path).write_text(html_content, encoding="utf-8")
                self.status_left.config(text=f"exported: {Path(save_path).name}")
                self._show_toast(f"Exported: {Path(save_path).name}")
            except OSError as e:
                messagebox.showerror("Export Error", f"Cannot export:\n{e}")

    def _escape_html(self, text: str) -> str:
        return (text.replace("&", "&amp;").replace("<", "&lt;")
                .replace(">", "&gt;").replace('"', "&quot;").replace("'", "&#x27;"))

    def _inline_html(self, text: str) -> str:
        text = self._escape_html(text)
        text = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', text)
        text = re.sub(r'`([^`]+)`', r'<code>\1</code>', text)
        def _safe_wikilink(m: re.Match) -> str:
            target = m.group(1)
            if ':' in target:
                return f'<span class="wikilink">{target}</span>'
            return f'<a href="{target}.html">{target}</a>'
        text = re.sub(r'\[\[([^\]]+)\]\]', _safe_wikilink, text)
        text = re.sub(r'(?<!\w)#(\w[\w-]*)', r'<span class="tag">#\1</span>', text)
        return text

    def _on_editor_click(self, event):
        """Handle checkbox toggle on click."""
        idx = self.editor.index(f"@{event.x},{event.y}")
        li = int(idx.split(".")[0])
        line = self.editor.get(f"{li}.0", f"{li}.end")
        m = re.match(r'^(\s*- )\[ \](\s.*)', line)
        if m:
            col = idx.split(".")[1]
            bracket_start = len(m.group(1))
            bracket_end = bracket_start + 3
            if bracket_start <= int(col) <= bracket_end + 1:
                self.editor.delete(f"{li}.{bracket_start}", f"{li}.{bracket_end}")
                self.editor.insert(f"{li}.{bracket_start}", "[x]")
                self._apply_syntax()
                return
        m = re.match(r'^(\s*- )\[x\](\s.*)', line)
        if m:
            col = idx.split(".")[1]
            bracket_start = len(m.group(1))
            bracket_end = bracket_start + 3
            if bracket_start <= int(col) <= bracket_end + 1:
                self.editor.delete(f"{li}.{bracket_start}", f"{li}.{bracket_end}")
                self.editor.insert(f"{li}.{bracket_start}", "[ ]")
                self._apply_syntax()
                return
        self._hide_autocomplete()

    # ─── EDITOR CONTEXT MENU ────────────────────────────────────
    def _on_editor_right_click(self, event):
        """Show editor context menu on right-click."""
        self.editor_ctx_menu.tk_popup(event.x_root, event.y_root)

    def _editor_ctx_cut(self):
        try:
            self.editor.event_generate("<<Cut>>")
        except tk.TclError:
            pass

    def _editor_ctx_copy(self):
        try:
            self.editor.event_generate("<<Copy>>")
        except tk.TclError:
            pass

    def _editor_ctx_paste(self):
        try:
            self.editor.event_generate("<<Paste>>")
        except tk.TclError:
            pass

    # ─── FORMATTING ──────────────────────────────────────────────
    def _format_wrap(self, marker: str):
        """Wrap selection with marker (e.g. ** for bold)."""
        try:
            sel_start = self.editor.index("sel.first")
            sel_end = self.editor.index("sel.last")
            selected = self.editor.get(sel_start, sel_end)
            self.editor.delete(sel_start, sel_end)
            self.editor.insert(sel_start, f"{marker}{selected}{marker}")
        except tk.TclError:
            # No selection — insert markers around cursor
            pos = self.editor.index("insert")
            self.editor.insert(pos, f"{marker}{marker}")
            self.editor.mark_set("insert", f"{pos}+{len(marker)}c")
        self._apply_syntax()

    def _format_bold(self):
        self._format_wrap("**")
        return "break"

    def _format_italic(self):
        self._format_wrap("*")
        return "break"

    def _format_code(self):
        self._format_wrap("`")
        return "break"

    def _format_link(self):
        """Insert wiki-link around selection or at cursor."""
        try:
            sel_start = self.editor.index("sel.first")
            sel_end = self.editor.index("sel.last")
            selected = self.editor.get(sel_start, sel_end)
            self.editor.delete(sel_start, sel_end)
            self.editor.insert(sel_start, f"[[{selected}]]")
        except tk.TclError:
            pos = self.editor.index("insert")
            self.editor.insert(pos, "[[]]")
            self.editor.mark_set("insert", f"{pos}+2c")
        self._apply_syntax()
        return "break"

    def _format_heading(self):
        """Toggle/cycle heading level on current line."""
        idx = self.editor.index("insert")
        li = idx.split(".")[0]
        line = self.editor.get(f"{li}.0", f"{li}.end")
        if line.startswith("### "):
            self.editor.delete(f"{li}.0", f"{li}.4")
        elif line.startswith("## "):
            self.editor.delete(f"{li}.0", f"{li}.3")
            self.editor.insert(f"{li}.0", "### ")
        elif line.startswith("# "):
            self.editor.delete(f"{li}.0", f"{li}.2")
            self.editor.insert(f"{li}.0", "## ")
        else:
            self.editor.insert(f"{li}.0", "# ")
        self._apply_syntax()

    def _format_checkbox(self):
        """Insert checkbox at current line."""
        idx = self.editor.index("insert")
        li = idx.split(".")[0]
        line = self.editor.get(f"{li}.0", f"{li}.end")
        if re.match(r'^\s*- \[[ x]\]', line):
            return
        if line.startswith("- "):
            self.editor.insert(f"{li}.2", "[ ] ")
        else:
            self.editor.insert(f"{li}.0", "- [ ] ")
        self._apply_syntax()

    def _on_bracket(self, event):
        """Detect [[ and show autocomplete."""
        self.root.after(50, self._check_autocomplete)

    def _check_autocomplete(self):
        idx = self.editor.index("insert")
        li = int(idx.split(".")[0])
        col = int(idx.split(".")[1])
        line = self.editor.get(f"{li}.0", f"{li}.end")
        before_cursor = line[:col]
        if "[[" in before_cursor and "]]" not in before_cursor[before_cursor.rfind("[["):]:
            partial = before_cursor[before_cursor.rfind("[[") + 2:]
            self._show_autocomplete(partial)
        else:
            self._hide_autocomplete()

    def _show_autocomplete(self, partial: str):
        self._autocomplete_popup.delete(0, "end")
        matches = []
        partial_lower = partial.lower()
        for fp in self._all_files:
            if partial_lower in fp.stem.lower():
                matches.append(fp.stem)
        if not matches:
            self._hide_autocomplete()
            return
        for m in matches[:8]:
            self._autocomplete_popup.insert("end", m)
        # Pre-select first match for keyboard-driven workflow
        self._autocomplete_popup.selection_set(0)
        try:
            bbox = self.editor.bbox("insert")
            if bbox:
                x, y, _, h = bbox
                self._autocomplete_popup.place(x=x, y=y + h + 2, width=200)
                self._autocomplete_visible = True
        except Exception:
            pass

    def _hide_autocomplete(self):
        if self._autocomplete_visible:
            self._autocomplete_popup.place_forget()
            self._autocomplete_visible = False

    def _on_autocomplete_select(self, event):
        sel = self._autocomplete_popup.curselection()
        if not sel:
            return
        name = self._autocomplete_popup.get(sel[0])
        idx = self.editor.index("insert")
        li = int(idx.split(".")[0])
        col = int(idx.split(".")[1])
        line = self.editor.get(f"{li}.0", f"{li}.end")
        before = line[:col]
        start = before.rfind("[[")
        if start >= 0:
            self.editor.delete(f"{li}.{start}", f"{li}.{col}")
            self.editor.insert(f"{li}.{start}", f"[[{name}]]")
        self._hide_autocomplete()
        self._apply_syntax()

    # ─── AI FUNCTIONS ────────────────────────────────────────────

    def _show_ai_palette(self):
        """AI Command Palette — Ctrl+K. Central hub for all AI features."""
        win = tk.Toplevel(self.root)
        win.title("Shumilek AI")
        win.geometry("420x480")
        win.configure(bg=P["obsidian"])
        self._prepare_modal(win)
        win.overrideredirect(True)
        # Center on screen
        win.update_idletasks()
        sw = self.root.winfo_screenwidth()
        sh = self.root.winfo_screenheight()
        x = (sw - 420) // 2
        y = (sh - 480) // 2
        win.geometry(f"420x480+{x}+{y}")

        # Title
        hdr = tk.Frame(win, bg=P["surface"], height=44)
        hdr.pack(fill="x")
        hdr.pack_propagate(False)
        tk.Label(hdr, text="\u2728 SHUMILEK AI", font=F_HEAD,
                 fg=P["cyan"], bg=P["surface"]).pack(side="left", padx=12)
        tk.Label(hdr, text="Ctrl+K", font=F_PIXEL,
                 fg=P["text_dim"], bg=P["surface"]).pack(side="right", padx=12)

        # AI commands
        cmds_frame = tk.Frame(win, bg=P["obsidian"])
        cmds_frame.pack(fill="both", expand=True, padx=8, pady=8)

        ai_commands = [
            ("\U0001f4dd Summarize Note", "Extract key points from current note",
             lambda: [win.destroy(), self._ai_summarize()]),
            ("\U0001f3f7\ufe0f  Suggest Tags", "Analyze content and suggest tags",
             lambda: [win.destroy(), self._ai_suggest_tags()]),
            ("\U0001f517 Smart Links", "Find related notes to link",
             lambda: [win.destroy(), self._ai_smart_links()]),
            ("\u270d\ufe0f  Writing Prompts", "Get AI continuation ideas",
             lambda: [win.destroy(), self._ai_writing_prompts()]),
            ("\U0001f4ca Analyze Note", "Readability, structure, stats",
             lambda: [win.destroy(), self._ai_analyze()]),
            ("\U0001f52e Generate Title", "Suggest a title from content",
             lambda: [win.destroy(), self._ai_generate_title()]),
        ]

        for label, desc, cmd in ai_commands:
            btn_frame = tk.Frame(cmds_frame, bg=P["panel"], cursor="hand2")
            btn_frame.pack(fill="x", pady=2)
            # Make entire frame clickable
            btn = tk.Button(btn_frame, text=label, font=(FONT, 11, "bold"),
                            fg=P["text_bright"], bg=P["panel"],
                            activebackground=P["hover"], activeforeground=P["cyan"],
                            anchor="w", bd=0, padx=12, pady=6,
                            command=cmd, cursor="hand2")
            btn.pack(fill="x", side="top")
            tk.Label(btn_frame, text=f"  {desc}", font=F_PIXEL,
                     fg=P["text_dim"], bg=P["panel"], anchor="w"
            ).pack(fill="x", padx=12)

        sep = tk.Frame(win, bg=P["border"], height=1)
        sep.pack(fill="x", padx=20, pady=8)

        # AI info
        info = tk.Frame(win, bg=P["obsidian"])
        info.pack(fill="x", padx=12, pady=4)
        tk.Label(info, text="Local AI analysis \u2022 no external API",
                 font=F_PIXEL, fg=P["text_dim"], bg=P["obsidian"]).pack()
        tk.Label(info, text="keyword extraction \u2022 TF analysis \u2022 pattern matching",
                 font=F_PIXEL, fg=P["text_dim"], bg=P["obsidian"]).pack()

        tk.Button(win, text="Close  [Esc]", font=F_SMALL,
                  fg=P["text_dim"], bg=P["surface"],
                  activebackground=P["hover"], bd=0,
                  command=win.destroy, cursor="hand2"
        ).pack(pady=8)
        win.bind("<Escape>", lambda e: win.destroy())
        win.focus_set()

    def _ai_get_content(self) -> str | None:
        """Get current note content, or None with a warning."""
        if not self.current_file:
            messagebox.showinfo("AI", "Open a note first.")
            return None
        return self.editor.get("1.0", "end-1c")

    def _ai_extract_keywords(self, text: str, top_n: int = 12) -> list[tuple[str, int]]:
        """Extract top keywords from text using term frequency analysis."""
        # Tokenize
        words = re.findall(r'[a-zA-Z\u00C0-\u017E]{3,}', text.lower())
        freq: dict[str, int] = {}
        for w in words:
            if w not in _STOP_WORDS and len(w) >= 3:
                freq[w] = freq.get(w, 0) + 1
        return sorted(freq.items(), key=lambda x: x[1], reverse=True)[:top_n]

    def _ai_summarize(self):
        """AI Summarize — extract key points from the current note."""
        content = self._ai_get_content()
        if content is None:
            return
        lines = content.strip().split("\n")
        title = self.current_file.stem

        # Extract headings
        headings = [l.lstrip("#").strip() for l in lines if re.match(r'^#{1,3}\s', l)]
        # Extract keywords
        keywords = self._ai_extract_keywords(content, 8)
        # Key sentences (first non-empty line after each heading, or first 3 content lines)
        key_sentences = []
        for i, line in enumerate(lines):
            if re.match(r'^#{1,3}\s', line) and i + 1 < len(lines):
                nxt = lines[i + 1].strip()
                if nxt and not nxt.startswith("#"):
                    key_sentences.append(nxt[:80])
        if not key_sentences:
            for l in lines:
                s = l.strip()
                if s and not s.startswith("#") and not re.match(r'^[-*>|]', s):
                    key_sentences.append(s[:80])
                    if len(key_sentences) >= 3:
                        break
        # Stats
        word_count = len(content.split())
        link_count = len(re.findall(r'\[\[([^\]]+)\]\]', content))
        tag_list = re.findall(r'(?<!\w)#(\w[\w-]*)', content)
        tasks_done = len(re.findall(r'- \[x\]', content))
        tasks_total = tasks_done + len(re.findall(r'- \[ \]', content))

        # Show result
        win = tk.Toplevel(self.root)
        win.title(f"AI Summary — {title}")
        win.geometry("500x520")
        win.configure(bg=P["panel"])
        win.transient(self.root)

        tk.Label(win, text=f"\U0001f4dd AI SUMMARY: {title}", font=F_HEAD,
                 fg=P["heading"], bg=P["panel"]).pack(pady=(12, 4))

        txt = tk.Text(win, font=F_SMALL, bg=P["obsidian"], fg=P["text"],
                      bd=0, padx=16, pady=12, wrap="word",
                      highlightthickness=0, relief="flat")
        txt.pack(fill="both", expand=True, padx=8, pady=4)

        txt.tag_configure("h", font=F_HEAD, foreground=P["cyan"])
        txt.tag_configure("kw", foreground=P["emerald"])
        txt.tag_configure("dim", foreground=P["text_dim"])
        txt.tag_configure("val", foreground=P["cyan"])

        txt.insert("end", "STRUCTURE\n", "h")
        if headings:
            for h in headings[:8]:
                txt.insert("end", f"  \u25B8 {h}\n")
        else:
            txt.insert("end", "  (no headings found)\n", "dim")

        txt.insert("end", "\nKEY POINTS\n", "h")
        if key_sentences:
            for s in key_sentences[:5]:
                txt.insert("end", f"  \u2022 {s}\n")
        else:
            txt.insert("end", "  (no key sentences extracted)\n", "dim")

        txt.insert("end", "\nKEYWORDS\n", "h")
        if keywords:
            kw_str = ", ".join(f"{w}({c})" for w, c in keywords)
            txt.insert("end", f"  {kw_str}\n", "kw")
        else:
            txt.insert("end", "  (not enough text)\n", "dim")

        txt.insert("end", "\nSTATS\n", "h")
        txt.insert("end", f"  Words: ", "dim")
        txt.insert("end", f"{word_count}\n", "val")
        txt.insert("end", f"  Links: ", "dim")
        txt.insert("end", f"{link_count}\n", "val")
        txt.insert("end", f"  Tags:  ", "dim")
        txt.insert("end", f"{', '.join(set(tag_list)) or 'none'}\n", "val")
        if tasks_total > 0:
            txt.insert("end", f"  Tasks: ", "dim")
            txt.insert("end", f"{tasks_done}/{tasks_total} done\n", "val")

        txt.config(state="disabled")
        tk.Button(win, text="Close", font=F_SMALL,
                  fg=P["cyan"], bg=P["surface"],
                  activebackground=P["hover"], bd=0,
                  command=win.destroy, cursor="hand2").pack(pady=8)
        self.status_left.config(text=f"AI: summarized {title}")

    def _ai_suggest_tags(self):
        """AI Auto-tag — suggest tags based on keyword analysis."""
        content = self._ai_get_content()
        if content is None:
            return
        keywords = self._ai_extract_keywords(content, 15)
        existing_tags = set(re.findall(r'(?<!\w)#(\w[\w-]*)', content))

        # Category patterns → tag suggestions
        category_rules = [
            (r'\b(bug|error|fix|crash|issue|debug)\b', "bug"),
            (r'\b(todo|task|plan|schedule|deadline)\b', "todo"),
            (r'\b(meeting|agenda|minutes|discussion)\b', "meeting"),
            (r'\b(idea|concept|brainstorm|prototype)\b', "idea"),
            (r'\b(pixel|sprite|tile|animation|art)\b', "pixel-art"),
            (r'\b(code|function|class|module|api|script)\b', "code"),
            (r'\b(recipe|ingredient|cook|bake)\b', "recipe"),
            (r'\b(journal|diary|today|daily|log)\b', "journal"),
            (r'\b(lore|world|character|quest|story)\b', "lore"),
            (r'\b(mineral|crystal|gem|stone|ore|rock)\b', "minerals"),
            (r'\b(monster|creature|beast|enemy)\b', "bestiary"),
            (r'\b(learn|study|practice|tutorial|guide)\b', "learning"),
            (r'\b(project|build|release|deploy|ship)\b', "project"),
            (r'\b(stardew|farm|harvest|season|crop)\b', "stardew"),
        ]

        suggested: list[tuple[str, str]] = []  # (tag, reason)
        cl = content.lower()
        for pattern, tag in category_rules:
            if re.search(pattern, cl) and tag not in existing_tags:
                matches = re.findall(pattern, cl)
                suggested.append((tag, f"found: {', '.join(set(matches)[:3])}"))

        # Top keywords as potential tags
        for word, count in keywords[:6]:
            if word not in existing_tags and count >= 2 and len(word) >= 4:
                suggested.append((word, f"appears {count}x"))

        # Show result
        win = tk.Toplevel(self.root)
        win.title("AI Suggest Tags")
        win.geometry("400x420")
        win.configure(bg=P["panel"])
        win.transient(self.root)

        tk.Label(win, text="\U0001f3f7\ufe0f  AI TAG SUGGESTIONS", font=F_HEAD,
                 fg=P["heading"], bg=P["panel"]).pack(pady=(12, 4))

        if existing_tags:
            tk.Label(win, text=f"Existing: {', '.join(f'#{t}' for t in sorted(existing_tags))}",
                     font=F_PIXEL, fg=P["text_dim"], bg=P["panel"]).pack(padx=12)

        frame = tk.Frame(win, bg=P["panel"])
        frame.pack(fill="both", expand=True, padx=12, pady=8)

        selected_tags: list[tk.BooleanVar] = []
        if suggested:
            for tag, reason in suggested:
                row = tk.Frame(frame, bg=P["panel"])
                row.pack(fill="x", pady=1)
                var = tk.BooleanVar(value=False)
                selected_tags.append(var)
                cb = tk.Checkbutton(row, text=f"#{tag}", font=(FONT, 10, "bold"),
                                    fg=P["cyan"], bg=P["panel"],
                                    selectcolor=P["surface"],
                                    activebackground=P["panel"],
                                    activeforeground=P["emerald"],
                                    variable=var, cursor="hand2")
                cb.pack(side="left")
                tk.Label(row, text=f"  {reason}", font=F_PIXEL,
                         fg=P["text_dim"], bg=P["panel"]).pack(side="left")
        else:
            tk.Label(frame, text="No new tags to suggest.\nNote may already be well-tagged.",
                     font=F_SMALL, fg=P["text_dim"], bg=P["panel"]).pack(pady=20)

        def apply_tags():
            tags_to_add = []
            for i, (tag, _) in enumerate(suggested):
                if i < len(selected_tags) and selected_tags[i].get():
                    tags_to_add.append(f"#{tag}")
            if tags_to_add:
                self.editor.insert("end", "\n" + " ".join(tags_to_add))
                self._apply_syntax()
                self.status_left.config(text=f"AI: added {len(tags_to_add)} tags")
            win.destroy()

        btn_frame = tk.Frame(win, bg=P["panel"])
        btn_frame.pack(pady=8)
        if suggested:
            tk.Button(btn_frame, text="Apply Selected", font=F_SMALL,
                      fg=P["emerald"], bg=P["surface"],
                      activebackground=P["hover"], bd=0,
                      command=apply_tags, cursor="hand2").pack(side="left", padx=4)
        tk.Button(btn_frame, text="Close", font=F_SMALL,
                  fg=P["text_dim"], bg=P["surface"],
                  activebackground=P["hover"], bd=0,
                  command=win.destroy, cursor="hand2").pack(side="left", padx=4)

    def _ai_smart_links(self):
        """AI Smart Links — find related notes based on content similarity."""
        content = self._ai_get_content()
        if content is None:
            return
        current_stem = self.current_file.stem
        current_kw = dict(self._ai_extract_keywords(content, 20))
        existing_links = set(re.findall(r'\[\[([^\]]+)\]\]', content))

        # Score each other note
        scores: list[tuple[str, float, list[str]]] = []
        for fp in self._all_files:
            if fp.stem == current_stem:
                continue
            try:
                other_content = self._read_cached(fp)
                if not other_content:
                    continue
                other_kw = dict(self._ai_extract_keywords(other_content, 20))
                # Jaccard-like overlap
                shared = set(current_kw.keys()) & set(other_kw.keys())
                if not shared:
                    continue
                score = sum(min(current_kw[w], other_kw[w]) for w in shared)
                scores.append((fp.stem, score, sorted(shared)[:5]))
            except Exception:
                pass

        scores.sort(key=lambda x: x[1], reverse=True)

        # Show result
        win = tk.Toplevel(self.root)
        win.title("AI Smart Links")
        win.geometry("440x420")
        win.configure(bg=P["panel"])
        win.transient(self.root)

        tk.Label(win, text="\U0001f517 AI SMART LINKS", font=F_HEAD,
                 fg=P["heading"], bg=P["panel"]).pack(pady=(12, 4))
        tk.Label(win, text=f"Related notes for: {current_stem}",
                 font=F_SMALL, fg=P["text_dim"], bg=P["panel"]).pack()

        frame = tk.Frame(win, bg=P["panel"])
        frame.pack(fill="both", expand=True, padx=12, pady=8)

        if scores:
            for name, score, shared_words in scores[:8]:
                row = tk.Frame(frame, bg=P["panel"])
                row.pack(fill="x", pady=2)
                linked = name in existing_links
                prefix = "\u2705" if linked else "\U0001f517"
                btn = tk.Button(row, text=f"{prefix} [[{name}]]",
                                font=(FONT, 10, "bold"),
                                fg=P["link"] if not linked else P["ok"],
                                bg=P["panel"],
                                activebackground=P["hover"],
                                activeforeground=P["cyan"],
                                bd=0, anchor="w", cursor="hand2",
                                command=lambda n=name: self._ai_insert_link(n, win))
                btn.pack(side="left")
                bar_len = min(int(score * 3), 20)
                bar = "\u2588" * bar_len
                tk.Label(row, text=f" {bar} ", font=F_PIXEL,
                         fg=P["cyan_dim"], bg=P["panel"]).pack(side="left")
                tk.Label(row, text=", ".join(shared_words),
                         font=F_PIXEL, fg=P["text_dim"], bg=P["panel"]).pack(side="left")
        else:
            tk.Label(frame, text="No related notes found.\nAdd more content to improve matching.",
                     font=F_SMALL, fg=P["text_dim"], bg=P["panel"]).pack(pady=20)

        tk.Button(win, text="Close", font=F_SMALL,
                  fg=P["text_dim"], bg=P["surface"],
                  activebackground=P["hover"], bd=0,
                  command=win.destroy, cursor="hand2").pack(pady=8)

    def _ai_insert_link(self, name: str, win: tk.Toplevel):
        """Insert a wiki-link at cursor position."""
        self.editor.insert("insert", f" [[{name}]]")
        self._apply_syntax()
        self.status_left.config(text=f"AI: linked to {name}")
        win.destroy()

    def _ai_writing_prompts(self):
        """AI Writing Prompts — suggest continuations based on note context."""
        content = self._ai_get_content()
        if content is None:
            return

        lines = content.strip().split("\n")
        keywords = self._ai_extract_keywords(content, 6)
        kw_names = [w for w, _ in keywords]
        title = self.current_file.stem
        has_headings = any(l.startswith("#") for l in lines)
        has_bullets = any(re.match(r'^\s*[-*]\s', l) for l in lines)
        has_tasks = any("[ ]" in l or "[x]" in l for l in lines)
        has_links = bool(re.findall(r'\[\[', content))

        prompts: list[tuple[str, str]] = []  # (prompt_text, insert_text)

        # Context-aware prompts
        if has_tasks:
            prompts.append(("Add a new task", "- [ ] "))
            prompts.append(("Add task section", "\n## Next Steps\n\n- [ ] \n- [ ] \n- [ ] \n"))
        if has_headings:
            prompts.append(("Add a new section", f"\n## \n\n"))
            prompts.append(("Add summary section", "\n## Summary\n\n> \n"))
        if has_bullets:
            prompts.append(("Continue bullet list", "\n- "))
        if has_links:
            prompts.append(("Add see-also section", "\n## See Also\n\n- [[]]\n"))

        # Keyword-based prompts
        if "bug" in kw_names or "error" in kw_names:
            prompts.append(("Add fix description", "\n## Fix\n\n**Root cause:** \n**Solution:** \n"))
            prompts.append(("Add reproduction steps", "\n## Steps to Reproduce\n\n1. \n2. \n3. \n"))
        if "meeting" in kw_names or "agenda" in kw_names:
            prompts.append(("Add action items", "\n## Action Items\n\n- [ ] \n- [ ] \n"))
            prompts.append(("Add decisions", "\n## Decisions\n\n- \n"))
        if any(w in kw_names for w in ("pixel", "sprite", "art", "tile")):
            prompts.append(("Add color palette", "\n## Color Palette\n\n- Primary: `#`\n- Secondary: `#`\n- Accent: `#`\n"))
        if any(w in kw_names for w in ("lore", "character", "quest")):
            prompts.append(("Add character details", "\n## Character\n\n- **Name:** \n- **Role:** \n- **Traits:** \n"))
        if any(w in kw_names for w in ("mineral", "crystal", "gem")):
            prompts.append(("Add mineral entry", "\n## New Mineral\n\n- **Found at:** \n- **Rarity:** \n- **Properties:** \n"))

        # Universal prompts
        prompts.append(("Add thoughts section", "\n## Thoughts\n\n> "))
        prompts.append(("Add metadata", f"\n---\ncreated: {datetime.date.today()}\ntags: \n---\n"))
        prompts.append(("Add table", "\n| Column 1 | Column 2 | Column 3 |\n|----------|----------|----------|\n| | | |\n"))

        # Show
        win = tk.Toplevel(self.root)
        win.title("AI Writing Prompts")
        win.geometry("460x440")
        win.configure(bg=P["panel"])
        win.transient(self.root)

        tk.Label(win, text="\u270d\ufe0f  AI WRITING PROMPTS", font=F_HEAD,
                 fg=P["heading"], bg=P["panel"]).pack(pady=(12, 4))
        tk.Label(win, text=f"Context: {title} | Keywords: {', '.join(kw_names[:4])}",
                 font=F_PIXEL, fg=P["text_dim"], bg=P["panel"]).pack()

        frame = tk.Frame(win, bg=P["panel"])
        frame.pack(fill="both", expand=True, padx=12, pady=8)

        for prompt_label, insert_text in prompts[:10]:
            btn = tk.Button(frame, text=f"  \u25B8 {prompt_label}",
                            font=(FONT, 10), fg=P["text"], bg=P["panel"],
                            activebackground=P["hover"], activeforeground=P["cyan"],
                            bd=0, anchor="w", padx=8, pady=4, cursor="hand2",
                            command=lambda t=insert_text: [
                                self.editor.insert("end", t),
                                self._apply_syntax(),
                                self.status_left.config(text="AI: prompt inserted"),
                                win.destroy()
                            ])
            btn.pack(fill="x", pady=1)

        tk.Button(win, text="Close", font=F_SMALL,
                  fg=P["text_dim"], bg=P["surface"],
                  activebackground=P["hover"], bd=0,
                  command=win.destroy, cursor="hand2").pack(pady=8)

    def _ai_analyze(self):
        """AI Note Analysis — readability, structure, writing metrics."""
        content = self._ai_get_content()
        if content is None:
            return

        lines = content.strip().split("\n")
        words = content.split()
        word_count = len(words)
        char_count = len(content)
        line_count = len(lines)
        sentence_count = len(re.findall(r'[.!?]+', content)) or 1
        avg_word_len = sum(len(w) for w in words) / max(len(words), 1)
        avg_sentence_len = word_count / sentence_count

        # Structure
        h1 = sum(1 for l in lines if l.startswith("# "))
        h2 = sum(1 for l in lines if l.startswith("## "))
        h3 = sum(1 for l in lines if l.startswith("### "))
        bullet_count = sum(1 for l in lines if re.match(r'^\s*[-*]\s', l))
        code_count = sum(1 for l in lines if '`' in l)
        link_count = len(re.findall(r'\[\[([^\]]+)\]\]', content))
        tag_count = len(set(re.findall(r'(?<!\w)#(\w[\w-]*)', content)))
        tasks_done = len(re.findall(r'- \[x\]', content))
        tasks_open = len(re.findall(r'- \[ \]', content))
        empty_lines = sum(1 for l in lines if not l.strip())

        # Readability score (simplified Flesch-like)
        if word_count > 10:
            readability = max(0, min(100, 
                100 - (avg_sentence_len * 1.5) - (avg_word_len * 12) + 40))
        else:
            readability = 50

        # Completeness rating
        completeness = 0
        if h1 >= 1:
            completeness += 20
        if h2 >= 1:
            completeness += 15
        if word_count >= 50:
            completeness += 15
        if link_count >= 1:
            completeness += 15
        if tag_count >= 1:
            completeness += 10
        if bullet_count >= 1:
            completeness += 10
        if word_count >= 200:
            completeness += 15

        # Show
        win = tk.Toplevel(self.root)
        win.title("AI Note Analysis")
        win.geometry("440x560")
        win.configure(bg=P["panel"])
        win.transient(self.root)

        tk.Label(win, text="\U0001f4ca AI ANALYSIS", font=F_HEAD,
                 fg=P["heading"], bg=P["panel"]).pack(pady=(12, 4))

        txt = tk.Text(win, font=F_SMALL, bg=P["obsidian"], fg=P["text"],
                      bd=0, padx=16, pady=12, wrap="word",
                      highlightthickness=0, relief="flat")
        txt.pack(fill="both", expand=True, padx=8, pady=4)

        txt.tag_configure("h", font=F_HEAD, foreground=P["cyan"])
        txt.tag_configure("good", foreground=P["ok"])
        txt.tag_configure("warn", foreground=P["ember"])
        txt.tag_configure("dim", foreground=P["text_dim"])
        txt.tag_configure("val", foreground=P["cyan"])
        txt.tag_configure("bar_fill", foreground=P["emerald"])
        txt.tag_configure("bar_empty", foreground=P["border"])

        txt.insert("end", "READABILITY\n", "h")
        rb = int(readability)
        bar_full = "\u2588" * (rb // 5)
        bar_empty = "\u2591" * (20 - rb // 5)
        txt.insert("end", f"  {bar_full}", "bar_fill")
        txt.insert("end", f"{bar_empty}", "bar_empty")
        tag = "good" if rb >= 60 else "warn"
        txt.insert("end", f"  {rb}/100\n", tag)
        txt.insert("end", f"  Avg sentence: {avg_sentence_len:.1f} words | ", "dim")
        txt.insert("end", f"Avg word: {avg_word_len:.1f} chars\n", "dim")

        txt.insert("end", "\nCOMPLETENESS\n", "h")
        cp = min(completeness, 100)
        bar_full = "\u2588" * (cp // 5)
        bar_empty = "\u2591" * (20 - cp // 5)
        txt.insert("end", f"  {bar_full}", "bar_fill")
        txt.insert("end", f"{bar_empty}", "bar_empty")
        tag = "good" if cp >= 70 else "warn"
        txt.insert("end", f"  {cp}/100\n", tag)
        checks = [
            ("Title (# heading)", h1 >= 1),
            ("Sections (##)", h2 >= 1),
            ("Content (50+ words)", word_count >= 50),
            ("Wiki-links", link_count >= 1),
            ("Tags", tag_count >= 1),
            ("Lists", bullet_count >= 1),
            ("Depth (200+ words)", word_count >= 200),
        ]
        for label, ok in checks:
            icon = "\u2705" if ok else "\u2610"
            txt.insert("end", f"  {icon} {label}\n", "good" if ok else "dim")

        txt.insert("end", "\nSTRUCTURE\n", "h")
        txt.insert("end", f"  Lines: ", "dim")
        txt.insert("end", f"{line_count}", "val")
        txt.insert("end", f" | Words: ", "dim")
        txt.insert("end", f"{word_count}", "val")
        txt.insert("end", f" | Chars: ", "dim")
        txt.insert("end", f"{char_count}\n", "val")
        txt.insert("end", f"  H1: {h1}  H2: {h2}  H3: {h3}\n", "dim")
        txt.insert("end", f"  Bullets: {bullet_count}  Code: {code_count}  "
                   f"Links: {link_count}  Tags: {tag_count}\n", "dim")
        if tasks_done + tasks_open > 0:
            txt.insert("end", f"  Tasks: {tasks_done}/{tasks_done + tasks_open} complete\n", "val")
        txt.insert("end", f"  Empty lines: {empty_lines} "
                   f"({empty_lines * 100 // max(line_count, 1)}%)\n", "dim")

        # Keywords
        txt.insert("end", "\nTOP KEYWORDS\n", "h")
        keywords = self._ai_extract_keywords(content, 8)
        if keywords:
            for w, c in keywords:
                bar = "\u2588" * min(c, 15)
                txt.insert("end", f"  {w:<16}", "val")
                txt.insert("end", f" {bar} {c}\n", "bar_fill")

        txt.config(state="disabled")
        tk.Button(win, text="Close", font=F_SMALL,
                  fg=P["cyan"], bg=P["surface"],
                  activebackground=P["hover"], bd=0,
                  command=win.destroy, cursor="hand2").pack(pady=8)
        self.status_left.config(text="AI: analysis complete")

    def _ai_generate_title(self):
        """AI Generate Title — suggest title based on content analysis."""
        content = self._ai_get_content()
        if content is None:
            return

        lines = content.strip().split("\n")
        keywords = self._ai_extract_keywords(content, 5)
        kw_names = [w.capitalize() for w, _ in keywords]

        suggestions = []
        # Strategy 1: from first heading
        for l in lines:
            if l.startswith("# "):
                suggestions.append(l[2:].strip())
                break
        # Strategy 2: from keywords
        if kw_names:
            suggestions.append(" ".join(kw_names[:3]))
            suggestions.append(f"{kw_names[0]} Notes")
            if len(kw_names) >= 2:
                suggestions.append(f"{kw_names[0]} & {kw_names[1]}")
        # Strategy 3: from first content line
        for l in lines:
            s = l.strip()
            if s and not s.startswith("#") and len(s) > 5:
                # Use first few words
                words = s.split()[:5]
                suggestions.append(" ".join(words))
                break
        # Strategy 4: date-based
        suggestions.append(f"Notes {datetime.date.today()}")

        # Dedup
        seen = set()
        unique = []
        for s in suggestions:
            if s.lower() not in seen:
                seen.add(s.lower())
                unique.append(s)

        win = tk.Toplevel(self.root)
        win.title("AI Generate Title")
        win.geometry("400x320")
        win.configure(bg=P["panel"])
        win.transient(self.root)

        tk.Label(win, text="\U0001f52e AI TITLE SUGGESTIONS", font=F_HEAD,
                 fg=P["heading"], bg=P["panel"]).pack(pady=(12, 8))

        frame = tk.Frame(win, bg=P["panel"])
        frame.pack(fill="both", expand=True, padx=12, pady=4)

        for title_sug in unique:
            btn = tk.Button(frame, text=f"  \u25B8 {title_sug}",
                            font=(FONT, 10), fg=P["text"], bg=P["panel"],
                            activebackground=P["hover"], activeforeground=P["cyan"],
                            bd=0, anchor="w", padx=8, pady=4, cursor="hand2",
                            command=lambda t=title_sug: [
                                self._ai_apply_title(t),
                                win.destroy()
                            ])
            btn.pack(fill="x", pady=1)

        tk.Button(win, text="Close", font=F_SMALL,
                  fg=P["text_dim"], bg=P["surface"],
                  activebackground=P["hover"], bd=0,
                  command=win.destroy, cursor="hand2").pack(pady=8)

    def _ai_apply_title(self, new_title: str):
        """Apply a suggested title: update first line if it's a heading."""
        content = self.editor.get("1.0", "end-1c")
        first_line = content.split("\n")[0] if content else ""
        if first_line.startswith("# "):
            self.editor.delete("1.0", "1.end")
            self.editor.insert("1.0", f"# {new_title}")
        else:
            self.editor.insert("1.0", f"# {new_title}\n\n")
        self._apply_syntax()
        self.modified = True
        self.status_left.config(text=f"AI: title set to '{new_title}'")

    # ─── HIVE VIEW: AI NEURAL VISUALIZATION + TASK SYSTEM ───────

    def _build_hive_view(self):
        """Build the Hive view — AI neural visualization + task queue."""
        self.hive_frame = tk.Frame(self.center_frame, bg=P["void"])

        # Top: Neural canvas
        self.hive_top = tk.Frame(self.hive_frame, bg=P["void"])
        self.hive_top.pack(fill="both", expand=True)

        self.hive_canvas = tk.Canvas(self.hive_top, bg=P["void"],
                                     highlightthickness=0, cursor="crosshair")
        self.hive_canvas.pack(fill="both", expand=True)
        self.hive_canvas.bind("<Configure>", lambda e: self._on_canvas_resize("hive"))

        # Middle: task input bar
        input_bar = tk.Frame(self.hive_frame, bg=P["surface"], height=42)
        input_bar.pack(fill="x")
        input_bar.pack_propagate(False)

        tk.Label(input_bar, text="\u25B8 Assign task:", font=F_SMALL,
                 fg=P["cyan"], bg=P["surface"]).pack(side="left", padx=(10, 4))

        self.hive_task_var = tk.StringVar()
        self.hive_task_entry = tk.Entry(
            input_bar, textvariable=self.hive_task_var,
            font=F_MONO, bg=P["panel"], fg=P["text"],
            insertbackground=P["cyan"], bd=0,
            highlightthickness=1, highlightcolor=P["cyan"],
            highlightbackground=P["border"]
        )
        self.hive_task_entry.pack(side="left", fill="x", expand=True, padx=4, pady=6)
        self.hive_task_entry.bind("<Return>", lambda e: self._hive_submit_task())

        tk.Button(input_bar, text="Send", font=F_SMALL,
                  fg=P["emerald"], bg=P["panel"],
                  activebackground=P["hover"], activeforeground=P["cyan"],
                  bd=0, padx=12, cursor="hand2",
                  command=self._hive_submit_task).pack(side="left", padx=(2, 4), pady=6)

        # Quick task buttons
        for label, task_text in [
            ("Scan vault", "scan vault and report statistics"),
            ("Find gaps", "find missing links and orphan notes"),
            ("Rate quality", "analyze note quality across vault"),
            ("Health check", "comprehensive vault health analysis"),
        ]:
            tk.Button(input_bar, text=label, font=F_PIXEL,
                      fg=P["text_dim"], bg=P["surface"],
                      activebackground=P["hover"], activeforeground=P["cyan"],
                      bd=0, padx=6, cursor="hand2",
                      command=lambda t=task_text: self._hive_quick_task(t)
                      ).pack(side="right", padx=2, pady=6)

        # History viewer button
        tk.Button(input_bar, text="\U0001F4CB History", font=F_PIXEL,
                  fg=P["amethyst"], bg=P["surface"],
                  activebackground=P["hover"], activeforeground=P["ice"],
                  bd=0, padx=6, cursor="hand2",
                  command=self._hive_show_history
                  ).pack(side="right", padx=2, pady=6)

        # Export task history button
        tk.Button(input_bar, text="\U0001F4E4 Export", font=F_PIXEL,
                  fg=P["emerald"], bg=P["surface"],
                  activebackground=P["hover"], activeforeground=P["ice"],
                  bd=0, padx=6, cursor="hand2",
                  command=self._export_task_history
                  ).pack(side="right", padx=2, pady=6)

        # Bottom: task list + activity log + output
        bottom = tk.Frame(self.hive_frame, bg=P["obsidian"], height=210)
        bottom.pack(fill="x")
        bottom.pack_propagate(False)
        bottom.columnconfigure(0, weight=1)
        bottom.columnconfigure(1, weight=1)
        bottom.columnconfigure(2, weight=2)
        bottom.rowconfigure(0, weight=1)

        # Left: task queue
        tq_frame = tk.Frame(bottom, bg=P["panel"])
        tq_frame.grid(row=0, column=0, sticky="nsew", padx=(2, 1), pady=2)

        # Task queue header with filter controls
        tq_header = tk.Frame(tq_frame, bg=P["surface"])
        tq_header.pack(fill="x")
        tk.Label(tq_header, text="TASK QUEUE", font=F_PIXEL,
                 fg=P["cyan"], bg=P["surface"]).pack(side="left", padx=(4, 0))

        self._hive_filter_status = tk.StringVar(value="all")
        for label, val in [("All", "all"), ("Err", "error"), ("Done", "done")]:
            tk.Radiobutton(
                tq_header, text=label, variable=self._hive_filter_status,
                value=val, font=F_PIXEL, fg=P["text_dim"], bg=P["surface"],
                selectcolor=P["panel"], activebackground=P["surface"],
                indicatoron=0, bd=0, padx=4, pady=1, cursor="hand2",
                command=self._hive_update_task_list,
            ).pack(side="right", padx=1)

        self.hive_task_list = tk.Text(
            tq_frame, font=F_SMALL, bg=P["panel"], fg=P["text"],
            bd=0, padx=6, pady=4, height=8, state="disabled",
            highlightthickness=0, relief="flat", wrap="word"
        )
        self.hive_task_list.pack(fill="both", expand=True)
        self.hive_task_list.bind("<Button-1>", self._on_hive_task_click)
        self.hive_task_list.tag_configure("pending", foreground=P["text_dim"])
        self.hive_task_list.tag_configure("running", foreground=P["cyan"])
        self.hive_task_list.tag_configure("done", foreground=P["ok"])
        self.hive_task_list.tag_configure("error", foreground=P["ember"])
        self.hive_task_list.tag_configure("id", foreground=P["amethyst"])
        self.hive_task_list.tag_configure("progress", foreground=P["emerald"])

        # Right: activity log
        al_frame = tk.Frame(bottom, bg=P["panel"])
        al_frame.grid(row=0, column=1, sticky="nsew", padx=(1, 2), pady=2)
        tk.Label(al_frame, text="AI ACTIVITY", font=F_PIXEL,
                 fg=P["emerald"], bg=P["surface"]).pack(fill="x")
        self.hive_activity_log = tk.Text(
            al_frame, font=F_PIXEL, bg=P["panel"], fg=P["text_dim"],
            bd=0, padx=6, pady=4, height=8, state="disabled",
            highlightthickness=0, relief="flat", wrap="word"
        )
        self.hive_activity_log.pack(fill="both", expand=True)
        self.hive_activity_log.tag_configure("info", foreground=P["cyan"])
        self.hive_activity_log.tag_configure("ok", foreground=P["ok"])
        self.hive_activity_log.tag_configure("warn", foreground=P["ember"])
        self.hive_activity_log.tag_configure("think", foreground=P["amethyst"])
        self.hive_activity_log.tag_configure("time", foreground=P["text_dim"])

        out_frame = tk.Frame(bottom, bg=P["panel"])
        out_frame.grid(row=0, column=2, sticky="nsew", padx=(1, 2), pady=2)
        tk.Label(out_frame, text="HIVE OUTPUT", font=F_PIXEL,
                 fg=P["ice"], bg=P["surface"]).pack(fill="x")
        self.hive_output_text = tk.Text(
            out_frame, font=F_SMALL, bg=P["panel"], fg=P["text"],
            bd=0, padx=8, pady=6, height=8, state="disabled",
            highlightthickness=0, relief="flat", wrap="word"
        )
        self.hive_output_text.pack(fill="both", expand=True)
        self.hive_output_text.tag_configure("title", foreground=P["heading"], font=F_HEAD)
        self.hive_output_text.tag_configure("meta", foreground=P["text_dim"], font=F_PIXEL)
        self.hive_output_text.tag_configure("accent", foreground=P["cyan"])
        self.hive_action_bar = tk.Frame(out_frame, bg=P["panel"])
        self.hive_action_bar.pack(fill="x", padx=6, pady=(0, 6))
        self._hive_action_buttons: list[tk.Button] = []
        self._hive_set_output(
            "Hive online",
            "Submit a task or click a completed task to inspect concrete output based on the current note or the vault.",
        )

    def _hive_init_neurons(self):
        """Initialize neural network visualization nodes."""
        c = self.hive_canvas
        c.update_idletasks()
        w = max(c.winfo_width(), 600)
        h = max(c.winfo_height(), 400)

        self._ai_neurons = []
        self._ai_synapses = []
        self._ai_pulses = []

        layers = [
            ("input", 4, P["cyan"], ["Receive", "Parse", "Classify", "Queue"]),
            ("analyze", 5, P["amethyst"], ["Tokenize", "Keywords", "Patterns", "Similarity", "Structure"]),
            ("process", 4, P["ice"], ["Reason", "Generate", "Validate", "Score"]),
            ("output", 3, P["emerald"], ["Format", "Deliver", "Log"]),
        ]

        margin_x = 80
        margin_y = 60
        layer_spacing = (w - 2 * margin_x) / max(len(layers) - 1, 1)

        for li, (layer_name, count, color, labels) in enumerate(layers):
            lx = margin_x + li * layer_spacing
            neuron_spacing = (h - 2 * margin_y) / max(count - 1, 1)
            for ni in range(count):
                ny = margin_y + ni * neuron_spacing
                self._ai_neurons.append({
                    "x": lx, "y": ny,
                    "layer": layer_name, "color": color,
                    "label": labels[ni] if ni < len(labels) else "",
                    "activation": random.uniform(0.1, 0.4),
                    "size": random.randint(8, 14),
                    "phase": random.uniform(0, math.pi * 2),
                })

        # Synapses between adjacent layers
        for li in range(len(layers) - 1):
            count_a = layers[li][1]
            count_b = layers[li + 1][1]
            base_a = sum(layers[k][1] for k in range(li))
            base_b = sum(layers[k][1] for k in range(li + 1))
            for ai in range(count_a):
                for bi in range(count_b):
                    if random.random() < 0.6:
                        self._ai_synapses.append({
                            "src": base_a + ai, "dst": base_b + bi,
                            "weight": random.uniform(0.2, 1.0),
                            "active": False,
                        })

        self._ai_hive_initialized = True

        # Fire some initial pulses so the network looks alive immediately
        for _ in range(6):
            if self._ai_synapses:
                syn = random.choice(self._ai_synapses)
                self._ai_pulses.append({
                    "src": syn["src"], "dst": syn["dst"],
                    "t": random.uniform(0.0, 0.5),
                    "speed": random.uniform(0.015, 0.03),
                    "color": random.choice([P["cyan_dim"], P["amethyst_dim"],
                                           P["border_glow"], P["ice"]]),
                })

    def _hive_submit_task(self):
        """Submit a new task from the input bar."""
        text = self.hive_task_var.get().strip()
        if not text:
            return
        self.hive_task_var.set("")
        self._ai_task_counter += 1
        task = {
            "id": self._ai_task_counter,
            "text": text,
            "kind": self._hive_classify_task(text),
            "status": "pending",
            "progress": 0,
            "result": "",
            "detail": "",
            "actions": [],
            "created": time.time(),
            "steps": [],
            "retries": 0,
        }
        self._ai_tasks.append(task)
        # Cap task list — remove oldest finished tasks beyond 100
        if len(self._ai_tasks) > 100:
            _active = ["pending", "running"]
            self._ai_tasks = [
                t for t in self._ai_tasks
                if t["status"] in _active
            ] + [
                t for t in self._ai_tasks
                if t["status"] not in _active
            ][-50:]
        self._ai_log("info", f"Task #{task['id']} queued: {text[:50]}")
        self._hive_set_output(f"Task #{task['id']} queued", text, f"kind: {task['kind']}")
        self._hive_set_actions([])
        self._hive_update_task_list()
        if not self._ai_processing_task:
            self._hive_start_next_task()

    def _hive_cancel_task(self, task_id: int | None = None):
        """Cancel a running or pending task."""
        if task_id is None:
            task = self._ai_processing_task
        else:
            task = next((t for t in self._ai_tasks if t["id"] == task_id), None)
        if not task:
            return
        if task["status"] == "running":
            task["status"] = "cancelled"
            task["progress"] = task.get("progress", 0)
            task["result"] = "Cancelled by user"
            self._ai_log("warn", f"Task #{task['id']} cancelled")
            self._hive_save_task_history(task)
            self._ai_processing_task = None
            # Stop pipeline
            if self.pipeline.is_running:
                for nid in list(self.pipeline.node_states):
                    if self.pipeline.node_states[nid] in ("idle", "active"):
                        self.pipeline.node_states[nid] = "error"
                self.pipeline.is_running = False
            for neuron in self._ai_neurons:
                neuron["activation"] *= 0.2
            self._hive_update_task_list()
            self._hive_set_output(f"Task #{task['id']} cancelled", task["text"], "status: cancelled")
            self._hive_set_actions([])
            self.root.after(300, self._hive_start_next_task)
        elif task["status"] == "pending":
            task["status"] = "cancelled"
            task["result"] = "Cancelled before start"
            self._hive_save_task_history(task)
            self._ai_log("warn", f"Task #{task['id']} cancelled (pending)")
            self._hive_update_task_list()

    def _hive_quick_task(self, text: str):
        self.hive_task_var.set(text)
        self._hive_submit_task()

    def _hive_queue_action_task(self, text: str):
        queued_text = str(text).strip()
        if not queued_text:
            return
        self.hive_task_var.set(queued_text)
        self._hive_submit_task()

    def _ai_log(self, level: str, msg: str):
        t = time.time()
        self._ai_activity_log.append((t, level, msg))
        if len(self._ai_activity_log) > 100:
            self._ai_activity_log = self._ai_activity_log[-80:]
        self._hive_update_activity()

    def _hive_set_output(self, title: str, body: str, meta: str = ""):
        ot = self.hive_output_text
        ot.config(state="normal")
        ot.delete("1.0", "end")
        ot.insert("end", title + "\n", "title")
        if meta:
            ot.insert("end", meta + "\n\n", "meta")
        else:
            ot.insert("end", "\n")
        if body:
            tag = "accent" if title == "Hive online" and not meta else None
            ot.insert("end", body.strip() + "\n", tag)
        ot.config(state="disabled")

    def _hive_show_history(self):
        """Load and display task history from vault JSON."""
        history_path = self.vault_path / "Hive Reports" / "task_history.json"
        if not history_path.exists():
            self._hive_set_output("Task History", "No task history yet.", "")
            self._hive_set_actions([])
            return
        try:
            raw = history_path.read_text(encoding="utf-8")
            history = json.loads(raw) if raw.strip() else []
        except Exception:
            self._hive_set_output("Task History", "Failed to load history file.", "")
            self._hive_set_actions([])
            return
        if not history:
            self._hive_set_output("Task History", "History is empty.", "")
            self._hive_set_actions([])
            return
        lines = []
        for entry in reversed(history[-30:]):
            status = entry.get("status", "?")
            icon = {"done": "\u2713", "error": "\u2718", "cancelled": "\u2715"}.get(status, "\u25CB")
            tid = entry.get("id", "?")
            kind = entry.get("kind", "task")
            text = entry.get("text", "")[:50]
            result = entry.get("result", "")[:40]
            ts = ""
            if entry.get("completed"):
                ts = datetime.datetime.fromtimestamp(entry["completed"]).strftime("%m/%d %H:%M")
            line = f"{icon} #{tid} [{kind}] {text}"
            if result:
                line += f"\n   \u2192 {result}"
            if ts:
                line += f"  ({ts})"
            lines.append(line)
        body = "\n".join(lines)
        self._hive_set_output(
            "Task History",
            body,
            f"showing last {min(30, len(history))} of {len(history)} entries",
        )
        self._hive_set_actions([])

    def _hive_set_actions(self, actions: list[dict] | None = None):
        for btn in self._hive_action_buttons:
            try:
                btn.destroy()
            except Exception:
                pass
        self._hive_action_buttons = []
        if not actions:
            return
        for action in actions[:5]:
            btn = tk.Button(
                self.hive_action_bar,
                text=action.get("label", "Action"),
                font=F_PIXEL,
                fg=P["cyan"],
                bg=P["surface"],
                activebackground=P["hover"],
                activeforeground=P["ice"],
                bd=0,
                padx=8,
                pady=3,
                cursor="hand2",
                command=lambda a=action: self._hive_run_action(a),
            )
            btn.pack(side="left", padx=(0, 4))
            self._hive_action_buttons.append(btn)

    def _hive_run_action(self, action: dict):
        kind = action.get("type")
        if kind == "apply-tags":
            self._hive_apply_tags(action.get("tags", []))
        elif kind in ("apply-top-fix", "apply-fix"):
            self._hive_apply_top_fix(action)
        elif kind == "queue-task":
            self._hive_queue_action_task(action.get("text", ""))
        elif kind == "insert-links":
            self._hive_insert_links(action.get("names", []))
        elif kind == "insert-summary":
            self._hive_insert_summary(action.get("summary", ""))
        elif kind == "insert-analysis":
            self._hive_insert_analysis(action.get("analysis", ""))
        elif kind == "save-report":
            self._hive_save_report(
                action.get("report_name", "Hive Report"),
                action.get("report_title", "Hive Report"),
                action.get("report_body", ""),
                action.get("report_summary", ""),
            )
        elif kind == "open-note":
            self._hive_open_note_by_stem(action.get("name", ""))
        elif kind == "apply-title":
            title = action.get("title", "").strip()
            if title:
                self._ai_apply_title(title)
                self.status_left.config(text=f"hive: applied title '{title}'")

    def _hive_open_note_by_stem(self, stem: str):
        if not stem:
            return
        for fp in self._hive_vault_files():
            if fp.stem == stem and fp.exists():
                self._maybe_save_then(lambda path=fp: self._open_file(path))
                self.status_left.config(text=f"hive: opened {stem}")
                return
        self.status_left.config(text=f"hive: note '{stem}' not found")

    def _hive_apply_tags(self, tags: list[str]):
        if not tags or not self.current_file:
            return
        content = self.editor.get("1.0", "end-1c")
        existing = set(re.findall(r'(?<!\w)#(\w[\w-]*)', content))
        normalized = []
        for tag in tags:
            clean = str(tag).lstrip("#").strip()
            if clean and clean not in existing:
                normalized.append(clean)
        if not normalized:
            self.status_left.config(text="hive: no new tags to add")
            return
        prefix = "\n" if content and not content.endswith("\n") else ""
        self.editor.insert("end", prefix + " ".join(f"#{tag}" for tag in normalized))
        self._apply_syntax()
        self.modified = True
        self.status_left.config(text=f"hive: added {len(normalized)} tags")

    def _hive_insert_links(self, names: list[str]):
        if not names or not self.current_file:
            return
        content = self.editor.get("1.0", "end-1c")
        existing = set(re.findall(r'\[\[([^\]|#]+)', content))
        selected = []
        for name in names:
            clean = str(name).strip()
            if clean and clean not in existing:
                selected.append(clean)
        if not selected:
            self.status_left.config(text="hive: suggested links already present")
            return
        insert_text = "\n## See Also\n\n" + "\n".join(f"- [[{name}]]" for name in selected[:5]) + "\n"
        self.editor.insert("end", insert_text)
        self._apply_syntax()
        self.modified = True
        self.status_left.config(text=f"hive: inserted {len(selected[:5])} links")

    def _hive_upsert_section(self, heading: str, body: str) -> bool:
        if not heading or not body or not self.current_file:
            return False
        content = self.editor.get("1.0", "end-1c")
        normalized_body = body.strip()
        if not normalized_body:
            return False
        block = f"## {heading}\n\n{normalized_body}\n"
        section_pattern = re.compile(
            rf'(?ms)^##\s+{re.escape(heading)}\s*\n.*?(?=^##\s|\Z)'
        )
        if section_pattern.search(content):
            updated = section_pattern.sub(block, content, count=1)
            action_text = f"updated {heading.lower()}"
        else:
            separator = "\n\n" if content.strip() else ""
            updated = content.rstrip() + separator + block
            action_text = f"inserted {heading.lower()}"
        self.editor.delete("1.0", "end")
        self.editor.insert("1.0", updated)
        self._apply_syntax()
        self.modified = True
        self.status_left.config(text=f"hive: {action_text}")
        return True

    def _hive_insert_section_once(self, heading: str, body: str) -> bool:
        if not heading or not body or not self.current_file:
            return False
        content = self.editor.get("1.0", "end-1c")
        if re.search(rf'(?m)^##\s+{re.escape(heading)}\s*$', content):
            self.status_left.config(text=f"hive: {heading.lower()} already exists")
            return False
        separator = "\n\n" if content.strip() else ""
        block = f"## {heading}\n\n{body.strip()}\n"
        self.editor.insert("end", separator + block)
        self._apply_syntax()
        self.modified = True
        self.status_left.config(text=f"hive: inserted {heading.lower()}")
        return True

    def _hive_analyze_note(self) -> tuple[str, str, list[dict]] | None:
        """Re-usable note analysis returning (summary, detail, actions) or None."""
        note_ctx = self._hive_current_note_context()
        if not note_ctx:
            return None
        files = self._hive_vault_files()
        content = note_ctx["content"]
        words = note_ctx["words"]
        lines = note_ctx["lines"]
        sentence_count = len(re.findall(r'[.!?]+', content)) or 1
        avg_word_len = sum(len(word) for word in words) / max(len(words), 1)
        avg_sentence_len = len(words) / sentence_count
        heading_counts = (
            sum(1 for line in lines if line.startswith("# ")),
            sum(1 for line in lines if line.startswith("## ")),
            sum(1 for line in lines if line.startswith("### ")),
        )
        bullets = sum(1 for line in lines if re.match(r'^\s*[-*]\s', line))
        link_count = len(re.findall(r'\[\[([^\]]+)\]\]', content))
        tag_count = len(set(re.findall(r'(?<!\w)#(\w[\w-]*)', content)))
        readability = 50 if len(words) <= 10 else max(0, min(100, 100 - (avg_sentence_len * 1.5) - (avg_word_len * 12) + 40))
        completeness = 0
        if heading_counts[0] >= 1:
            completeness += 20
        if heading_counts[1] >= 1:
            completeness += 15
        if len(words) >= 50:
            completeness += 15
        if link_count >= 1:
            completeness += 15
        if tag_count >= 1:
            completeness += 10
        if bullets >= 1:
            completeness += 10
        if len(words) >= 200:
            completeness += 15
        recommendations = []
        if heading_counts[0] == 0:
            recommendations.append("add one H1 title to anchor the note")
        if heading_counts[1] == 0 and len(words) >= 80:
            recommendations.append("split the note into H2 sections")
        if bullets == 0 and len(words) >= 120:
            recommendations.append("turn dense paragraphs into short bullet lists")
        if link_count == 0 and len(files) > 1:
            recommendations.append("link this note to at least one related vault note")
        if tag_count == 0:
            recommendations.append("add 1-3 tags for retrieval")
        fix_actions = []
        if heading_counts[0] == 0:
            title_keywords = [word.capitalize() for word, _ in self._ai_extract_keywords(content, 4)]
            suggested_title = " ".join(title_keywords[:3]).strip() or note_ctx["title"]
            fix_actions.append({
                "type": "apply-fix",
                "label": "Add Title",
                "fix_kind": "title",
                "title": suggested_title,
            })
        if heading_counts[1] == 0 and len(words) >= 80:
            fix_actions.append({
                "type": "apply-fix",
                "label": "Add Sections",
                "fix_kind": "sections",
                "heading": "Key Sections",
                "body": "## Context\n\n\n## Details\n\n\n## Next Steps\n\n",
            })
        if bullets == 0 and len(words) >= 120:
            fix_actions.append({
                "type": "apply-fix",
                "label": "Add Bullets",
                "fix_kind": "bullets",
                "heading": "Action Points",
                "body": "- key takeaway\n- open question\n- next action",
            })
        if tag_count == 0:
            suggested_tags = []
            for word, count in self._ai_extract_keywords(content, 10):
                if len(word) >= 4 and count >= 2:
                    suggested_tags.append(word)
            if suggested_tags:
                fix_actions.append({
                    "type": "apply-fix",
                    "label": "Add Tags",
                    "fix_kind": "tags",
                    "tags": suggested_tags[:3],
                })
        if link_count == 0 and len(files) > 1:
            related_candidates = self._hive_related_note_candidates(note_ctx, files, 3)
            if related_candidates:
                fix_actions.append({
                    "type": "apply-fix",
                    "label": "Add Links",
                    "fix_kind": "links",
                    "names": related_candidates,
                })
        analysis_detail = (
            f"Readability: {int(readability)}/100\n"
            f"Completeness: {min(completeness, 100)}/100\n"
            f"Words: {len(words)} | Lines: {len(lines)} | Avg sentence: {avg_sentence_len:.1f} | Avg word: {avg_word_len:.1f}\n"
            f"H1/H2/H3: {heading_counts[0]}/{heading_counts[1]}/{heading_counts[2]} | Bullets: {bullets} | Links: {link_count} | Tags: {tag_count}\n\n"
            f"Top keywords:\n" + "\n".join(f"- {word} ({count})" for word, count in self._ai_extract_keywords(content, 8))
        )
        if recommendations:
            analysis_detail += "\n\nRecommendations:\n" + "\n".join(f"- {item}" for item in recommendations)
        actions = fix_actions[:3] + [
            {"type": "insert-analysis", "label": "Insert Analysis", "analysis": analysis_detail},
            {"type": "queue-task", "label": "Re-Analyze", "text": "analyze current note structure and readability"},
        ]
        return (
            f"Analysis complete for {note_ctx['title']}",
            analysis_detail,
            actions,
        )

    def _hive_refresh_analysis(self):
        """Auto-refresh analysis output and action buttons after a fix."""
        result = self._hive_analyze_note()
        if result:
            summary, detail, actions = result
            self._hive_set_output(summary, detail, "auto-refreshed after fix")
            self._hive_set_actions(actions)

    def _hive_apply_top_fix(self, action: dict):
        fix_kind = action.get("fix_kind")
        applied = False
        if fix_kind == "title":
            title = action.get("title", "").strip()
            if title:
                self._ai_apply_title(title)
                self.status_left.config(text=f"hive: applied top fix title '{title}'")
                applied = True
        elif fix_kind == "sections":
            applied = self._hive_insert_section_once(action.get("heading", "Key Sections"), action.get("body", ""))
        elif fix_kind == "bullets":
            applied = self._hive_insert_section_once(action.get("heading", "Action Points"), action.get("body", ""))
        elif fix_kind == "tags":
            self._hive_apply_tags(action.get("tags", []))
            applied = True
        elif fix_kind == "links":
            self._hive_insert_links(action.get("names", []))
            applied = True
        if applied:
            self._hive_refresh_analysis()

    def _hive_insert_summary(self, summary: str):
        self._hive_upsert_section("Hive Summary", summary)

    def _hive_insert_analysis(self, analysis: str):
        self._hive_upsert_section("Hive Analysis", analysis)

    def _hive_report_path(self, report_name: str) -> Path:
        safe_name = re.sub(r'[^\w\- ]+', ' ', str(report_name)).strip() or "Hive Report"
        # Remove dots to prevent traversal (e.g. "..")
        safe_name = safe_name.replace(".", "")
        if not safe_name:
            safe_name = "Hive Report"
        report_dir = self.vault_path / "Hive Reports"
        return report_dir / f"{safe_name}.md"

    def _hive_save_report(self, report_name: str, report_title: str, report_body: str, report_summary: str = ""):
        body = report_body.strip()
        if not body:
            self.status_left.config(text="hive: no report body to save")
            return
        report_path = self._hive_report_path(report_name)
        summary_line = report_summary.strip() or report_title.strip() or report_name.strip()

        def write_and_open():
            try:
                report_path.parent.mkdir(parents=True, exist_ok=True)
                report_content = (
                    f"# {report_title.strip() or report_name.strip() or 'Hive Report'}\n\n"
                    f"Generated: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
                    f"Summary: {summary_line}\n\n"
                    f"## Report\n\n{body}\n"
                )
                report_path.write_text(report_content, encoding="utf-8")
            except OSError as exc:
                messagebox.showerror("Hive Report", f"Cannot save report:\n{exc}")
                return
            self._invalidate_cache(report_path)
            self._importance_cache.clear()
            self._rebuild_graph_data()
            self._refresh_file_tree()
            self._update_vault_stats()
            self._open_file(report_path)
            self.status_left.config(text=f"hive: saved report {report_path.stem}")

        self._maybe_save_then(write_and_open)

    def _on_hive_task_click(self, event):
        if not self._hive_task_line_map:
            return
        try:
            idx = self.hive_task_list.index(f"@{event.x},{event.y}")
            line_no = int(idx.split(".")[0])
            col = int(idx.split(".")[1])
        except Exception:
            return
        # Check if click is on the "[✕ cancel]" text in progress line
        try:
            line_text = self.hive_task_list.get(f"{line_no}.0", f"{line_no}.end")
        except Exception:
            line_text = ""
        for start_line, end_line, task_id in self._hive_task_line_map:
            if start_line <= line_no <= end_line:
                if "\u2715 cancel" in line_text:
                    self._hive_cancel_task(task_id)
                    return
                task = next((item for item in self._ai_tasks if item["id"] == task_id), None)
                if not task:
                    return
                detail = task.get("detail") or task.get("result") or task.get("text", "")
                meta = (
                    f"status: {task.get('status', 'unknown')}  |  "
                    f"progress: {task.get('progress', 0)}%  |  "
                    f"kind: {task.get('kind', 'task')}"
                )
                self._hive_set_output(f"Task #{task_id}", detail, meta)
                self._hive_set_actions(task.get("actions"))
                self.status_left.config(text=f"hive: opened task #{task_id} output")
                return

    def _hive_vault_files(self) -> list[Path]:
        files = [fp for fp in self._all_files if fp.exists()]
        if files:
            return files
        return [fp for fp in self.vault_path.glob("**/*.md") if fp.exists()]

    def _hive_current_note_context(self) -> dict | None:
        if not self.current_file or not self.current_file.exists():
            return None
        content = self.editor.get("1.0", "end-1c")
        if not content.strip():
            return None
        lines = content.split("\n")
        return {
            "path": self.current_file,
            "title": self.current_file.stem,
            "content": content,
            "lines": lines,
            "words": content.split(),
        }

    def _hive_related_note_candidates(self, note_ctx: dict, files: list[Path], limit: int = 5) -> list[str]:
        current_kw = dict(self._ai_extract_keywords(note_ctx["content"], 20))
        existing_links = set(re.findall(r'\[\[([^\]]+)\]\]', note_ctx["content"]))
        scores = []
        for fp in files:
            if fp == note_ctx["path"]:
                continue
            other_content = self._read_cached(fp)
            other_kw = dict(self._ai_extract_keywords(other_content, 20))
            shared = set(current_kw) & set(other_kw)
            if not shared:
                continue
            score = sum(min(current_kw[word], other_kw[word]) for word in shared)
            if fp.stem in existing_links:
                continue
            scores.append((score, fp.stem))
        scores.sort(reverse=True)
        return [stem for _, stem in scores[:limit]]

    def _hive_classify_task(self, text: str) -> str:
        text_lower = text.lower()
        if any(w in text_lower for w in ("title", "headline", "rename title")):
            return "title"
        if any(w in text_lower for w in ("tag", "categorize", "classify")):
            return "tags"
        if any(w in text_lower for w in ("smart link", "related note", "related notes", "connect note")):
            return "smart-links"
        if any(w in text_lower for w in ("summar", "tldr", "key point")):
            return "summary"
        if any(w in text_lower for w in ("readability", "structure review", "analyze note", "analyze current", "note analysis")):
            return "note-analysis"
        if any(w in text_lower for w in ("health", "diagnos", "check")):
            return "vault-health"
        if any(w in text_lower for w in ("link", "orphan", "missing", "gap", "broken")):
            return "vault-links"
        if any(w in text_lower for w in ("quality", "rate", "score")):
            return "vault-quality"
        if any(w in text_lower for w in ("scan", "vault", "stats", "statistic")):
            return "vault-stats"
        return "summary" if self.current_file else "vault-stats"

    def _hive_execute_task(self, task: dict) -> tuple[str, str, list[dict]]:
        kind = task.get("kind") or self._hive_classify_task(task["text"])
        note_ctx = self._hive_current_note_context()
        files = self._hive_vault_files()

        if kind == "summary":
            if not note_ctx:
                return (
                    "No open note to summarize",
                    "Open a note and submit a summary task again. Hive summary tasks work on the active note content.",
                    [],
                )
            content = note_ctx["content"]
            lines = note_ctx["lines"]
            headings = [line.lstrip("#").strip() for line in lines if re.match(r'^#{1,3}\s', line)]
            keywords = self._ai_extract_keywords(content, 8)
            key_points = []
            for i, line in enumerate(lines):
                if re.match(r'^#{1,3}\s', line) and i + 1 < len(lines):
                    nxt = lines[i + 1].strip()
                    if nxt and not nxt.startswith("#"):
                        key_points.append(nxt[:100])
            if not key_points:
                for line in lines:
                    stripped = line.strip()
                    if stripped and not stripped.startswith("#") and not re.match(r'^[-*>|]', stripped):
                        key_points.append(stripped[:100])
                    if len(key_points) >= 5:
                        break
            link_count = len(re.findall(r'\[\[([^\]]+)\]\]', content))
            tags = sorted(set(re.findall(r'(?<!\w)#(\w[\w-]*)', content)))
            summary = f"Summary ready for {note_ctx['title']}"
            detail = (
                f"Title: {note_ctx['title']}\n"
                f"Words: {len(note_ctx['words'])} | Links: {link_count} | Tags: {len(tags)}\n\n"
                f"Headings:\n" + ("\n".join(f"- {heading}" for heading in headings[:8]) if headings else "- no headings found")
                + "\n\nKey points:\n"
                + ("\n".join(f"- {point}" for point in key_points[:5]) if key_points else "- no key points extracted")
                + "\n\nKeywords:\n"
                + (", ".join(f"{word}({count})" for word, count in keywords) if keywords else "not enough signal")
            )
            actions = []
            if tags:
                detail += "\n\nTags:\n" + ", ".join(f"#{tag}" for tag in tags)
            actions.append({
                "type": "insert-summary",
                "label": "Insert Summary",
                "summary": detail,
            })
            return summary, detail, actions

        if kind == "tags":
            if not note_ctx:
                return (
                    "No open note to tag",
                    "Open a note first. Hive tag tasks analyze the current note and suggest concrete tags.",
                    [],
                )
            content = note_ctx["content"].lower()
            existing_tags = set(re.findall(r'(?<!\w)#(\w[\w-]*)', note_ctx["content"]))
            rules = [
                (r'\b(bug|error|fix|crash|issue|debug)\b', "bug"),
                (r'\b(todo|task|plan|deadline|backlog)\b', "todo"),
                (r'\b(meeting|agenda|minutes|discussion)\b', "meeting"),
                (r'\b(idea|concept|brainstorm|prototype)\b', "idea"),
                (r'\b(pixel|sprite|tile|animation|art)\b', "pixel-art"),
                (r'\b(code|function|class|module|api|script)\b', "code"),
                (r'\b(project|build|release|deploy|ship)\b', "project"),
            ]
            suggestions: list[tuple[str, str]] = []
            for pattern, tag in rules:
                if re.search(pattern, content) and tag not in existing_tags:
                    suggestions.append((tag, "pattern match"))
            for word, count in self._ai_extract_keywords(note_ctx["content"], 10):
                if len(word) >= 4 and count >= 2 and word not in existing_tags:
                    suggestions.append((word, f"keyword frequency {count}x"))
            seen = set()
            deduped = []
            for tag, reason in suggestions:
                if tag not in seen:
                    seen.add(tag)
                    deduped.append((tag, reason))
            actions = []
            if deduped:
                actions.append({
                    "type": "apply-tags",
                    "label": "Apply Tags",
                    "tags": [tag for tag, _ in deduped[:8]],
                })
            return (
                f"{len(deduped)} tag suggestions for {note_ctx['title']}",
                f"Current tags: {', '.join('#' + tag for tag in sorted(existing_tags)) or 'none'}\n\n"
                + (
                    "Suggested tags:\n" + "\n".join(f"- #{tag} | {reason}" for tag, reason in deduped)
                    if deduped else
                    "No strong new tags detected. The note may already be well tagged."
                ),
                actions,
            )

        if kind == "smart-links":
            if not note_ctx:
                return (
                    "No open note for smart links",
                    "Open a note first. Hive smart-link tasks compare the active note against the rest of the vault.",
                    [],
                )
            current_kw = dict(self._ai_extract_keywords(note_ctx["content"], 20))
            existing_links = set(re.findall(r'\[\[([^\]]+)\]\]', note_ctx["content"]))
            scores = []
            for fp in files:
                if fp == note_ctx["path"]:
                    continue
                other_content = self._read_cached(fp)
                other_kw = dict(self._ai_extract_keywords(other_content, 20))
                shared = sorted(set(current_kw) & set(other_kw))
                if not shared:
                    continue
                score = sum(min(current_kw[word], other_kw[word]) for word in shared)
                scores.append((fp.stem, score, shared[:5], fp.stem in existing_links))
            scores.sort(key=lambda item: item[1], reverse=True)
            actions = []
            candidates = [name for name, _, _, linked in scores if not linked]
            if candidates:
                actions.append({
                    "type": "insert-links",
                    "label": "Insert Links",
                    "names": candidates[:5],
                })
                actions.append({
                    "type": "open-note",
                    "label": f"Open {candidates[0]}",
                    "name": candidates[0],
                })
            return (
                f"{len(scores[:6])} related notes found for {note_ctx['title']}",
                "Related notes:\n" + (
                    "\n".join(
                        f"- {'linked' if linked else 'candidate'} [[{name}]] | score {score:.1f} | shared: {', '.join(shared_words)}"
                        for name, score, shared_words, linked in scores[:8]
                    ) if scores else "No related notes found with meaningful keyword overlap."
                ),
                actions,
            )

        if kind == "title":
            if not note_ctx:
                return (
                    "No open note for title generation",
                    "Open a note first. Hive title tasks generate candidates from the active note content.",
                    [],
                )
            suggestions = []
            for line in note_ctx["lines"]:
                if line.startswith("# "):
                    suggestions.append(line[2:].strip())
                    break
            keywords = [word.capitalize() for word, _ in self._ai_extract_keywords(note_ctx["content"], 5)]
            if keywords:
                suggestions.append(" ".join(keywords[:3]))
                suggestions.append(f"{keywords[0]} Notes")
                if len(keywords) >= 2:
                    suggestions.append(f"{keywords[0]} & {keywords[1]}")
            for line in note_ctx["lines"]:
                stripped = line.strip()
                if stripped and not stripped.startswith("#"):
                    suggestions.append(" ".join(stripped.split()[:5]))
                    break
            suggestions.append(f"Notes {datetime.date.today()}")
            unique = []
            seen = set()
            for item in suggestions:
                lowered = item.lower()
                if item and lowered not in seen:
                    seen.add(lowered)
                    unique.append(item)
            actions = []
            if unique:
                actions.append({
                    "type": "apply-title",
                    "label": "Apply Top Title",
                    "title": unique[0],
                })
            return f"{len(unique[:5])} title suggestions", "\n".join(f"- {item}" for item in unique[:5]), actions

        if kind == "note-analysis":
            result = self._hive_analyze_note()
            if result is None:
                return (
                    "No open note to analyze",
                    "Open a note first. Hive note analysis works on the active note and computes structure and readability metrics.",
                    [],
                )
            return result

        if kind == "vault-stats":
            total_words = 0
            total_links = 0
            total_tags = 0
            heading_count = 0
            top_notes = []
            for fp in files:
                content = self._read_cached(fp)
                words = len(content.split())
                total_words += words
                total_links += len(re.findall(r'\[\[([^\]]+)\]\]', content))
                total_tags += len(re.findall(r'(?<!\w)#(\w[\w-]*)', content))
                heading_count += len(re.findall(r'^#{1,3}\s', content, re.MULTILINE))
                top_notes.append((words, fp.stem))
            top_notes.sort(reverse=True)
            avg_words = total_words / max(len(files), 1)
            detail = (
                f"Notes: {len(files)}\nWords: {total_words}\nAverage words/note: {avg_words:.1f}\n"
                f"Links: {total_links}\nTags: {total_tags}\nHeadings: {heading_count}\n\n"
                f"Largest notes:\n" + "\n".join(f"- {stem}: {words} words" for words, stem in top_notes[:5])
            )
            actions = [{
                "type": "save-report",
                "label": "Save Report",
                "report_name": "Vault Stats Report",
                "report_title": "Hive Vault Stats Report",
                "report_body": detail,
                "report_summary": f"Vault scan complete: {len(files)} notes",
            }]
            if top_notes:
                actions.append({"type": "open-note", "label": f"Open {top_notes[0][1]}", "name": top_notes[0][1]})
            return (
                f"Vault scan complete: {len(files)} notes",
                detail,
                actions,
            )

        if kind == "vault-links":
            all_stems = {fp.stem for fp in files}
            outgoing = set()
            referenced = set()
            broken_targets: dict[str, int] = defaultdict(int)
            for fp in files:
                content = self._read_cached(fp)
                links = [match.split("|", 1)[0].split("#", 1)[0].strip() for match in re.findall(r'\[\[([^\]]+)\]\]', content)]
                if links:
                    outgoing.add(fp.stem)
                for link in links:
                    if not link:
                        continue
                    referenced.add(link)
                    if link not in all_stems:
                        broken_targets[link] += 1
            orphans = sorted(stem for stem in all_stems if stem not in outgoing and stem not in referenced)
            detail = (
                f"Orphans ({len(orphans)}): " + (", ".join(orphans[:10]) if orphans else "none")
                + "\n\nMissing targets: "
                + (
                    ", ".join(f"{name} ({count}x)" for name, count in sorted(broken_targets.items(), key=lambda item: (-item[1], item[0]))[:10])
                    if broken_targets else "none"
                )
            )
            actions = [{
                "type": "save-report",
                "label": "Save Report",
                "report_name": "Vault Link Audit",
                "report_title": "Hive Vault Link Audit",
                "report_body": detail,
                "report_summary": f"Link audit complete: {len(orphans)} orphans, {len(broken_targets)} missing targets",
            }]
            if orphans:
                actions.append({"type": "open-note", "label": f"Open {orphans[0]}", "name": orphans[0]})
            return (
                f"Link audit complete: {len(orphans)} orphans, {len(broken_targets)} missing targets",
                detail,
                actions,
            )

        if kind == "vault-quality":
            score_rows = []
            for fp in files:
                content = self._read_cached(fp)
                score = 0
                reasons = []
                if "# " in content:
                    score += 25
                    reasons.append("title")
                if "## " in content:
                    score += 15
                    reasons.append("sections")
                if len(content.split()) > 50:
                    score += 20
                    reasons.append("content")
                if "[[" in content:
                    score += 20
                    reasons.append("links")
                if re.search(r'(?<!\w)#(\w[\w-]*)', content):
                    score += 10
                    reasons.append("tags")
                if len(content.split()) > 200:
                    score += 10
                    reasons.append("depth")
                score_rows.append((score, fp.stem, ", ".join(reasons) or "thin"))
            score_rows.sort(reverse=True)
            avg = sum(score for score, _, _ in score_rows) / max(len(score_rows), 1)
            detail = (
                "Top notes:\n"
                + "\n".join(f"- {stem}: {score}/100 | {reasons}" for score, stem, reasons in score_rows[:5])
                + "\n\nNeeds work:\n"
                + "\n".join(f"- {stem}: {score}/100 | {reasons}" for score, stem, reasons in sorted(score_rows)[:5])
            )
            actions = [{
                "type": "save-report",
                "label": "Save Report",
                "report_name": "Vault Quality Report",
                "report_title": "Hive Vault Quality Report",
                "report_body": detail,
                "report_summary": f"Vault quality average: {avg:.0f}/100",
            }]
            if score_rows:
                actions.append({"type": "open-note", "label": f"Open {score_rows[0][1]}", "name": score_rows[0][1]})
            return (
                f"Vault quality average: {avg:.0f}/100",
                detail,
                actions,
            )

        if kind == "vault-health":
            all_stems = {fp.stem for fp in files}
            broken_links = 0
            short_notes = 0
            untagged = 0
            isolated = []
            incoming: defaultdict[str, int] = defaultdict(int)
            outgoing: defaultdict[str, int] = defaultdict(int)
            for fp in files:
                content = self._read_cached(fp)
                if len(content.split()) < 20:
                    short_notes += 1
                if not re.search(r'(?<!\w)#(\w[\w-]*)', content):
                    untagged += 1
                for raw in re.findall(r'\[\[([^\]]+)\]\]', content):
                    link = raw.split("|", 1)[0].split("#", 1)[0].strip()
                    if not link:
                        continue
                    outgoing[fp.stem] += 1
                    incoming[link] += 1
                    if link not in all_stems:
                        broken_links += 1
            for stem in sorted(all_stems):
                if incoming.get(stem, 0) == 0 and outgoing.get(stem, 0) == 0:
                    isolated.append(stem)
            health = max(0, 100 - broken_links * 10 - short_notes * 4 - untagged * 2 - len(isolated) * 3)
            detail = (
                f"Broken links: {broken_links}\nThin notes (<20 words): {short_notes}\n"
                f"Untagged notes: {untagged}\nIsolated notes: {len(isolated)}\n\n"
                f"Isolated sample:\n" + ("\n".join(f"- {stem}" for stem in isolated[:10]) if isolated else "none")
            )
            actions = [{
                "type": "save-report",
                "label": "Save Report",
                "report_name": "Vault Health Report",
                "report_title": "Hive Vault Health Report",
                "report_body": detail,
                "report_summary": f"Vault health: {health}/100",
            }]
            if isolated:
                actions.append({"type": "open-note", "label": f"Open {isolated[0]}", "name": isolated[0]})
            return (
                f"Vault health: {health}/100",
                detail,
                actions,
            )

        return self._hive_execute_task({"text": task.get("text", ""), "kind": "summary" if note_ctx else "vault-stats"})

    def _hive_update_task_list(self):
        tl = self.hive_task_list
        tl.config(state="normal")
        tl.delete("1.0", "end")
        self._hive_task_line_map = []
        status_filter = getattr(self, "_hive_filter_status", None)
        filter_val = status_filter.get() if status_filter else "all"
        candidates = [t for t in self._ai_tasks[-15:] if t["status"] != "cancelled"]
        if filter_val == "error":
            candidates = [t for t in candidates if t["status"] == "error"]
        elif filter_val == "done":
            candidates = [t for t in candidates if t["status"] == "done"]
        for task in reversed(candidates):
            start_line = int(tl.index("end-1c").split(".")[0])
            tid = f"#{task['id']}"
            pri = task.get("priority", 0)
            pri_tag = f" \u2191{pri}" if pri > 0 else ""
            retries = task.get("retries", 0)
            retry_tag = f" \u21BB{retries}" if retries > 0 else ""
            if task["status"] == "running":
                bar_len = task["progress"] // 5
                bar = "\u2588" * bar_len + "\u2591" * (20 - bar_len)
                tl.insert("end", " \u25B6 ", "running")
                tl.insert("end", f"{tid} ", "id")
                tl.insert("end", f"{task['text'][:30]}\n", "running")
                tl.insert("end", f"   [{bar}] {task['progress']}%  [\u2715 cancel]\n", "progress")
            elif task["status"] == "done":
                tl.insert("end", " \u2713 ", "done")
                tl.insert("end", f"{tid} ", "id")
                tl.insert("end", f"{task['text'][:30]}\n", "done")
                if task["result"]:
                    tl.insert("end", f"   \u2192 {task['result'][:50]}\n", "done")
            elif task["status"] == "error":
                tl.insert("end", " \u2718 ", "error")
                tl.insert("end", f"{tid}{retry_tag} ", "id")
                tl.insert("end", f"{task['text'][:30]}\n", "error")
                if task["result"]:
                    tl.insert("end", f"   \u2192 {task['result'][:50]}\n", "error")
            else:
                tl.insert("end", " \u25CB ", "pending")
                tl.insert("end", f"{tid}{pri_tag}{retry_tag} ", "id")
                tl.insert("end", f"{task['text'][:40]}\n", "pending")
            end_line = int(tl.index("end-1c").split(".")[0])
            self._hive_task_line_map.append((start_line, end_line, task["id"]))
        tl.config(state="disabled")

    def _hive_update_activity(self):
        al = self.hive_activity_log
        al.config(state="normal")
        al.delete("1.0", "end")
        for t, level, msg in self._ai_activity_log[-20:]:
            ts = datetime.datetime.fromtimestamp(t).strftime("%H:%M:%S")
            al.insert("end", f"[{ts}] ", "time")
            al.insert("end", f"{msg}\n", level)
        al.config(state="disabled")
        al.see("end")

    # Task kind → pipeline scenario mapping
    _TASK_PIPELINE_MAP = {
        "vault-health": "retry",
        "vault-quality": "retry",
        "vault-links": "hallucination",
        "smart-links": "hallucination",
        "note-analysis": "success",
        "vault-stats": "success",
        "tags": "success",
        "summary": "success",
        "title": "success",
    }

    def _hive_start_next_task(self):
        if self._ai_processing_task:
            return  # guard against concurrent scheduling
        # Pick highest-priority pending task
        pending = [t for t in self._ai_tasks if t["status"] == "pending"]
        if not pending:
            return
        pending.sort(key=lambda t: t.get("priority", 0), reverse=True)
        task = pending[0]
        task["status"] = "running"
        task["progress"] = 0
        self._ai_processing_task = task
        self._ai_process_tick = 0
        self._ai_log("info", f"Starting task #{task['id']}")
        self._hive_plan_task(task)
        # Start pipeline alongside the task
        scenario = self._TASK_PIPELINE_MAP.get(
            task.get("kind", ""), "default")
        self.pipeline.start_scenario(scenario)
        self._ai_log("info", f"Pipeline scenario: {scenario}")
        self._hive_set_output(f"Task #{task['id']} starting", task["text"], f"kind: {task.get('kind', 'task')}")
        self._hive_set_actions([])

    def _hive_plan_task(self, task: dict):
        kind = task.get("kind") or self._hive_classify_task(task["text"])
        task["kind"] = kind
        steps = [("Parsing input", 8), ("Tokenizing content", 6)]

        if kind == "vault-stats":
            steps += [("Scanning vault files", 15), ("Counting words and links", 12),
                      ("Computing statistics", 10), ("Generating report", 8)]
        elif kind == "vault-links":
            steps += [("Building link graph", 12), ("Finding orphan nodes", 10),
                      ("Detecting missing links", 14), ("Scoring connectivity", 8)]
        elif kind == "vault-quality":
            steps += [("Reading all notes", 12), ("Analyzing structure", 14),
                      ("Scoring readability", 10), ("Computing quality scores", 12)]
        elif kind == "vault-health":
            steps += [("Scanning vault structure", 12), ("Detecting orphan notes", 10),
                      ("Analyzing link integrity", 14), ("Checking tag coverage", 8),
                      ("Scoring note quality", 12), ("Compiling health report", 10)]
        elif kind == "tags":
            steps += [("Extracting keywords", 10), ("Matching patterns", 12),
                      ("Assigning tags", 8)]
        elif kind == "summary":
            steps += [("Extracting headings", 8), ("Finding key sentences", 12),
                      ("Building summary", 10)]
        elif kind == "smart-links":
            steps += [("Reading current note", 8), ("Comparing note graph", 12),
                      ("Ranking related notes", 10)]
        elif kind == "note-analysis":
            steps += [("Reading current note", 8), ("Computing readability", 12),
                      ("Scoring structure", 10), ("Preparing report", 8)]
        elif kind == "title":
            steps += [("Reading current note", 8), ("Extracting candidate phrases", 10),
                      ("Ranking titles", 8)]
        else:
            steps += [("Analyzing request", 10), ("Gathering context", 12),
                      ("Processing data", 15), ("Generating response", 10)]

        steps += [("Formatting output", 6), ("Validating result", 5)]
        task["steps"] = steps
        task["_step_idx"] = 0
        task["_step_tick"] = 0

    def _hive_process_tick(self):
        task = self._ai_processing_task
        if not task or task["status"] != "running":
            return

        steps = task.get("steps", [])
        if not steps:
            self._hive_complete_task(task)
            return
        step_idx = task.get("_step_idx", 0)
        step_tick = task.get("_step_tick", 0)

        if step_idx >= len(steps):
            self._hive_complete_task(task)
            return

        step_name, step_duration = steps[step_idx]
        task["_step_tick"] = step_tick + 1

        total_ticks = sum(d for _, d in steps)
        done_ticks = sum(d for _, d in steps[:step_idx]) + step_tick
        task["progress"] = min(99, int(done_ticks / max(total_ticks, 1) * 100))

        if step_tick == 0:
            self._ai_log("think", f"  \u25B8 {step_name}...")
            self._hive_activate_neurons(step_idx, len(steps))

        if step_tick >= step_duration:
            task["_step_idx"] = step_idx + 1
            task["_step_tick"] = 0
            self._ai_log("ok", f"    \u2713 {step_name} done")

        self._hive_update_task_list()

    def _hive_activate_neurons(self, step_idx: int, total_steps: int):
        if not self._ai_neurons:
            return
        layer_names = ["input", "analyze", "process", "output"]
        progress = step_idx / max(total_steps - 1, 1)
        active_li = min(int(progress * len(layer_names)), len(layer_names) - 1)
        active_layer = layer_names[active_li]

        for neuron in self._ai_neurons:
            if neuron["layer"] == active_layer:
                neuron["activation"] = random.uniform(0.6, 1.0)
            elif neuron["layer"] == layer_names[max(0, active_li - 1)]:
                neuron["activation"] = max(0, neuron["activation"] - 0.1)
            else:
                neuron["activation"] *= 0.85

        n_count = len(self._ai_neurons)
        for syn in self._ai_synapses:
            si, di = syn["src"], syn["dst"]
            if si >= n_count or di >= n_count:
                continue
            src = self._ai_neurons[si]
            if src["activation"] > 0.4 and random.random() < 0.3:
                syn["active"] = True
                self._ai_pulses.append({
                    "src": si, "dst": di,
                    "t": 0.0, "speed": random.uniform(0.03, 0.08),
                    "color": src["color"],
                })

    # ── Pipeline → Hive neuron mapping ──
    _PIPELINE_LAYER_MAP = {
        "context": "input", "routing": "input",
        "rozum": "analyze",
        "generate": "process", "guardian": "process",
        "halluc": "process", "svedomi": "process",
        "decision": "output", "output": "output",
    }

    def _hive_pipeline_sync(self):
        """Activate hive neurons based on real pipeline stage states."""
        if not self._ai_neurons:
            return
        n_count = len(self._ai_neurons)
        # Find which layers have active/done stages
        active_layers: set[str] = set()
        done_layers: set[str] = set()
        for nid, state in self.pipeline.node_states.items():
            layer = self._PIPELINE_LAYER_MAP.get(nid)
            if not layer:
                continue
            if state == "active":
                active_layers.add(layer)
            elif state in ("done", "error", "retry"):
                done_layers.add(layer)

        for neuron in self._ai_neurons:
            if neuron["layer"] in active_layers:
                neuron["activation"] = max(neuron["activation"],
                                           random.uniform(0.6, 1.0))
            elif neuron["layer"] in done_layers:
                neuron["activation"] = max(neuron["activation"], 0.15)

        # Fire pulses from active layers to downstream synapses
        if self._anim_tick % 8 == 0 and self._ai_synapses:
            for syn in self._ai_synapses:
                si, di = syn["src"], syn["dst"]
                if si >= n_count or di >= n_count:
                    continue
                src = self._ai_neurons[si]
                if src["layer"] in active_layers and random.random() < 0.25:
                    self._ai_pulses.append({
                        "src": si, "dst": di,
                        "t": 0.0, "speed": random.uniform(0.04, 0.09),
                        "color": src["color"],
                    })

        # Pipeline stage thought bubbles
        if self._anim_tick % 60 == 0:
            _stage_thoughts = {
                "context": "scanning workspace...",
                "routing": "routing query...",
                "rozum": "planning steps...",
                "generate": "generating response...",
                "guardian": "quality check...",
                "halluc": "hallucination scan...",
                "svedomi": "validating answer...",
                "decision": "pass/retry decision...",
                "output": "delivering result...",
            }
            for nid, state in self.pipeline.node_states.items():
                if state == "active" and nid in _stage_thoughts:
                    self._ai_add_thought(_stage_thoughts[nid])
                    break

    _TASK_HISTORY_MAX = 500

    def _hive_save_task_history(self, task: dict):
        """Append completed/cancelled task to vault JSON history."""
        history_dir = self.vault_path / "Hive Reports"
        history_dir.mkdir(parents=True, exist_ok=True)
        history_path = history_dir / "task_history.json"
        entry = {
            "id": task.get("id"),
            "text": task.get("text", "")[:200],
            "kind": task.get("kind", "task"),
            "status": task.get("status", "unknown"),
            "result": task.get("result", "")[:300],
            "created": task.get("created", 0),
            "completed": time.time(),
        }
        try:
            history: list = []
            if history_path.exists():
                raw = history_path.read_text(encoding="utf-8")
                if raw.strip():
                    history = json.loads(raw)
            history.append(entry)
            if len(history) > self._TASK_HISTORY_MAX:
                history = history[-self._TASK_HISTORY_MAX:]
            history_path.write_text(
                json.dumps(history, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
        except Exception:
            self._ai_log("warn", "Failed to save task history")

    _TASK_RETRY_MAX = 1

    def _hive_complete_task(self, task: dict):
        task["status"] = "done"
        task["progress"] = 100
        try:
            task["result"], task["detail"], task["actions"] = self._hive_execute_task(task)
        except Exception:
            task["status"] = "error"
            tb = traceback.format_exc()
            task["result"] = "Task failed with error"
            task["detail"] = tb[-500:] if len(tb) > 500 else tb
            task["actions"] = []
            self._ai_log("err", f"Task #{task['id']} error: {tb.splitlines()[-1][:80]}")
        # Auto-retry on error (up to _TASK_RETRY_MAX times)
        if task["status"] == "error" and task.get("retries", 0) < self._TASK_RETRY_MAX:
            task["retries"] = task.get("retries", 0) + 1
            task["status"] = "pending"
            task["progress"] = 0
            task["result"] = ""
            task["detail"] = ""
            task["actions"] = []
            self._ai_processing_task = None
            if self.pipeline.is_running:
                for nid in list(self.pipeline.node_states):
                    if self.pipeline.node_states[nid] in ("idle", "active"):
                        self.pipeline.node_states[nid] = "error"
                self.pipeline.is_running = False
            self._ai_log("warn", f"Task #{task['id']} retry {task['retries']}/{self._TASK_RETRY_MAX}")
            self._hive_update_task_list()
            self._hive_set_output(
                f"Task #{task['id']} retrying",
                f"Automatic retry {task['retries']}/{self._TASK_RETRY_MAX} after error",
                f"kind: {task.get('kind', 'task')}",
            )
            self.root.after(2000, self._hive_start_next_task)
            return
        self._hive_save_task_history(task)
        if task["status"] != "error":
            self._ai_log("ok", f"Task #{task['id']} complete: {task.get('result', '')[:60]}")
        self._ai_processing_task = None
        # Finish pipeline if still running
        if self.pipeline.is_running:
            end_state = "error" if task["status"] == "error" else "done"
            for nid in list(self.pipeline.node_states):
                if self.pipeline.node_states[nid] in ("idle", "active"):
                    self.pipeline.node_states[nid] = end_state
            self.pipeline.is_running = False
            self.pipeline.event_log.append(
                f"[{self.pipeline.elapsed_time:.1f}s] pipeline finished with task")
        self._hive_update_task_list()
        self._hive_set_output(
            f"Task #{task['id']}{' \u2718 ERROR' if task['status'] == 'error' else ''}",
            task["detail"],
            f"status: {task['status']}  |  kind: {task.get('kind', 'task')}  |  summary: {task['result']}",
        )
        self._hive_set_actions(task.get("actions"))
        self._update_vault_stats()

        for neuron in self._ai_neurons:
            neuron["activation"] *= 0.3

        self.root.after(500, self._hive_start_next_task)

    def _hive_draw(self):
        """Draw the neural network visualization on the hive canvas."""
        c = self.hive_canvas
        c.delete("all")
        w = max(c.winfo_width(), 600)
        h = max(c.winfo_height(), 400)

        if not self._ai_hive_initialized:
            self._hive_init_neurons()

        t = time.time()

        # Nebula clouds — large faint colored blobs in background
        if not hasattr(self, '_hive_nebulae'):
            self._hive_nebulae = []
            neb_colors = [P["cyan_dim"], P["amethyst_dim"], P["rose_dim"]]
            for _ in range(5):
                self._hive_nebulae.append({
                    "x": random.uniform(0.1, 0.9),
                    "y": random.uniform(0.1, 0.8),
                    "r": random.uniform(60, 120),
                    "color": random.choice(neb_colors),
                    "phase": random.uniform(0, math.pi * 2),
                })
        _draw_nebulae(c, w, h, self._hive_nebulae, rings=4, opacity=0.04, t=t)

        # Subtle grid
        for gx in range(0, w, 40):
            c.create_line(gx, 0, gx, h, fill="#0C0920", width=1)
        for gy in range(0, h, 40):
            c.create_line(0, gy, w, gy, fill="#0C0920", width=1)

        # Hex accents
        for gx in range(20, w, 80):
            for gy in range(20, h, 70):
                offset = 40 if (gy // 70) % 2 else 0
                px = gx + offset
                if 0 < px < w:
                    brightness = 0.15 + 0.1 * abs(math.sin(t * 0.5 + px * 0.01 + gy * 0.01))
                    col = int(10 * brightness)
                    c.create_text(px, gy, text="\u2B21", font=F_PIXEL,
                                 fill=f"#{col:02x}{col+2:02x}{col+8:02x}")

        # Constellation stars (twinkling idle dots between neurons — with drift)
        if not self._ai_processing_task:
            # Spawn new stars occasionally
            if self._hive_ambient_tick % 20 == 0 and len(self._hive_constellations) < 40:
                self._hive_constellations.append({
                    "x": random.uniform(0.05, 0.95),
                    "y": random.uniform(0.05, 0.85),
                    "vx": random.uniform(-0.0003, 0.0003),  # slow drift
                    "vy": random.uniform(-0.0002, 0.0002),
                    "phase": random.uniform(0, math.pi * 2),
                    "speed": random.uniform(0.8, 2.5),
                    "size": random.choice([1, 2, 2, 3]),
                    "color": random.choice([P["cyan_dim"], P["amethyst_dim"],
                                           P["border_glow"], P["ice"]]),
                    "life": 0,
                    "max_life": random.randint(120, 300),
                })
            new_stars = []
            for star in self._hive_constellations:
                star["life"] += 1
                # Drift position
                star["x"] += star.get("vx", 0)
                star["y"] += star.get("vy", 0)
                if star["life"] < star["max_life"] and 0.0 < star["x"] < 1.0 and 0.0 < star["y"] < 1.0:
                    new_stars.append(star)
                    sx = int(star["x"] * w)
                    sy = int(star["y"] * h)
                    twinkle = abs(math.sin(t * star["speed"] + star["phase"]))
                    if twinkle > 0.3:
                        base = star["color"].lstrip("#")
                        rr = int(int(base[:2], 16) * twinkle)
                        gg = int(int(base[2:4], 16) * twinkle)
                        bb = int(int(base[4:6], 16) * twinkle)
                        col = f"#{max(0,min(255,rr)):02x}{max(0,min(255,gg)):02x}{max(0,min(255,bb)):02x}"
                        sz = star["size"]
                        c.create_oval(sx - sz, sy - sz, sx + sz, sy + sz,
                                     fill=col, outline="")
                        if twinkle > 0.8 and sz >= 2:
                            # Cross + diagonal sparkle
                            c.create_line(sx - 4, sy, sx + 4, sy, fill=col, width=1)
                            c.create_line(sx, sy - 4, sx, sy + 4, fill=col, width=1)
                            # Diagonal rays (fainter)
                            dim_col = f"#{max(0,rr//2):02x}{max(0,gg//2):02x}{max(0,bb//2):02x}"
                            c.create_line(sx - 3, sy - 3, sx + 3, sy + 3, fill=dim_col, width=1)
                            c.create_line(sx + 3, sy - 3, sx - 3, sy + 3, fill=dim_col, width=1)
            self._hive_constellations = new_stars

        # Synapses (with glow for active connections)
        n_count = len(self._ai_neurons)
        for syn in self._ai_synapses:
            si, di = syn["src"], syn["dst"]
            if si >= n_count or di >= n_count:
                continue
            src = self._ai_neurons[si]
            dst = self._ai_neurons[di]
            activation = max(src["activation"], dst["activation"])
            if activation < 0.05:
                base = P["border"]
                c.create_line(src["x"], src["y"], dst["x"], dst["y"],
                             fill=base, width=1)
            else:
                br = min(1.0, activation * 0.8)
                r = int(70 * br); g = int(60 * br); b = int(130 * br)
                base = f"#{r:02x}{g:02x}{b:02x}"
                # Glow layer behind active synapses
                if activation > 0.25:
                    gr = max(0, r // 3); gg = max(0, g // 3); gb = max(0, b // 3)
                    c.create_line(src["x"], src["y"], dst["x"], dst["y"],
                                 fill=f"#{gr:02x}{gg:02x}{gb:02x}", width=3)
                c.create_line(src["x"], src["y"], dst["x"], dst["y"],
                             fill=base, width=1)

        # Pulses traveling along synapses (with glow halo + longer trail)
        new_pulses = []
        for pulse in self._ai_pulses:
            pulse["t"] += pulse["speed"]
            if pulse["t"] < 1.0:
                si, di = pulse["src"], pulse["dst"]
                if si >= n_count or di >= n_count:
                    continue
                new_pulses.append(pulse)
                src = self._ai_neurons[si]
                dst = self._ai_neurons[di]
                px = src["x"] + (dst["x"] - src["x"]) * pulse["t"]
                py = src["y"] + (dst["y"] - src["y"]) * pulse["t"]
                # Outer glow halo
                pcol = pulse["color"].lstrip("#")
                pr = int(pcol[:2], 16); pg = int(pcol[2:4], 16); pb = int(pcol[4:6], 16)
                ghr = max(0, pr // 4); ghg = max(0, pg // 4); ghb = max(0, pb // 4)
                c.create_oval(px - 6, py - 6, px + 6, py + 6,
                             fill=f"#{ghr:02x}{ghg:02x}{ghb:02x}", outline="")
                # Core pulse
                c.create_oval(px - 3, py - 3, px + 3, py + 3,
                             fill=pulse["color"], outline="")
                # Trail — 5 dots fading behind
                for i in range(5):
                    tt = pulse["t"] - (i + 1) * 0.025
                    if tt > 0:
                        tx = src["x"] + (dst["x"] - src["x"]) * tt
                        ty = src["y"] + (dst["y"] - src["y"]) * tt
                        frac = 1.0 - (i + 1) / 6.0
                        tr = max(0, min(255, int(pr * frac * 0.5)))
                        tg = max(0, min(255, int(pg * frac * 0.5)))
                        tb = max(0, min(255, int(pb * frac * 0.5)))
                        ts = 2 if i < 3 else 1
                        c.create_oval(tx - ts, ty - ts, tx + ts, ty + ts,
                                     fill=f"#{tr:02x}{tg:02x}{tb:02x}", outline="")
        self._ai_pulses = new_pulses[-80:] if len(new_pulses) > 80 else new_pulses

        # Neurons (multi-ring smooth radial gradient glow)
        for neuron in self._ai_neurons:
            x, y = neuron["x"], neuron["y"]
            size = neuron["size"]
            act = neuron["activation"]
            pulse = abs(math.sin(t * 2.5 + neuron["phase"]))

            if act > 0.15:
                base_col = neuron["color"].lstrip("#")
                r0 = int(base_col[:2], 16)
                g0 = int(base_col[2:4], 16)
                b0 = int(base_col[4:6], 16)
                # 5-ring smooth radial gradient (outermost → innermost)
                max_radius = size + int(act * 16) + int(pulse * 7)
                for ring_i in range(5):
                    frac = 1.0 - ring_i / 5.0  # 1.0, 0.8, 0.6, 0.4, 0.2
                    ring_r = int(max_radius * frac)
                    if ring_r < 1:
                        continue
                    brightness = 0.08 + ring_i * 0.06  # 0.08, 0.14, 0.20, 0.26, 0.32
                    rr = max(0, min(255, int(r0 * brightness * act)))
                    rg = max(0, min(255, int(g0 * brightness * act)))
                    rb = max(0, min(255, int(b0 * brightness * act)))
                    c.create_oval(x - ring_r, y - ring_r,
                                 x + ring_r, y + ring_r,
                                 fill=f"#{rr:02x}{rg:02x}{rb:02x}", outline="")
                # Core circle
                cr = min(255, int(r0 * (0.5 + act * 0.5)))
                cg = min(255, int(g0 * (0.5 + act * 0.5)))
                cb = min(255, int(b0 * (0.5 + act * 0.5)))
                c.create_oval(x - size, y - size, x + size, y + size,
                             fill=f"#{cr:02x}{cg:02x}{cb:02x}",
                             outline=neuron["color"], width=2)
            else:
                # Idle neurons: subtle pulse ring
                idle_br = 0.2 + 0.1 * pulse
                ir = max(0, min(255, int(30 * idle_br)))
                ig = max(0, min(255, int(25 * idle_br)))
                ib = max(0, min(255, int(60 * idle_br)))
                c.create_oval(x - size - 2, y - size - 2, x + size + 2, y + size + 2,
                             fill=f"#{ir:02x}{ig:02x}{ib:02x}", outline="")
                c.create_oval(x - size, y - size, x + size, y + size,
                             fill=P["panel"], outline=P["border"], width=1)

            if neuron["label"]:
                lc = neuron["color"] if act > 0.15 else P["text_dim"]
                c.create_text(x, y + size + 12, text=neuron["label"],
                             font=F_PIXEL, fill=lc)

        # Layer labels with glow text
        layers_info = [("INPUT", P["cyan"]), ("ANALYZE", P["amethyst"]),
                       ("PROCESS", P["ice"]), ("OUTPUT", P["emerald"])]
        margin_x = 80
        ls = (w - 2 * margin_x) / max(len(layers_info) - 1, 1)
        for i, (ln, lc) in enumerate(layers_info):
            lx = margin_x + i * ls
            # Glow text layer (offset)
            c.create_text(lx + 1, 21, text=ln, font=F_SMALL,
                         fill=_hex_color_scale(lc, 0.3))
            c.create_text(lx, 20, text=ln, font=F_SMALL, fill=lc)

        # Status overlay
        pipeline_live = self.pipeline.is_running
        has_task = self._ai_processing_task is not None
        if has_task or pipeline_live:
            # ── Main status panel (top-right) ──
            panel_h = 100 if pipeline_live else 60
            c.create_rectangle(w - 290, 10, w - 10, 10 + panel_h,
                              fill=P["surface"], outline=P["cyan_dim"], width=1)
            # Corner accents
            for (cx_, cy_) in [(w - 290, 10), (w - 14, 10),
                               (w - 290, 6 + panel_h), (w - 14, 6 + panel_h)]:
                c.create_rectangle(cx_, cy_, cx_ + 4, cy_ + 4,
                                  fill=P["cyan_dim"], outline="")

            if has_task:
                task = self._ai_processing_task
                c.create_text(w - 280, 22, text=f"\u25B6 Processing #{task['id']}",
                             font=F_SMALL, fill=P["cyan"], anchor="w")
                bar_x = w - 280
                bar_w = 250
                c.create_rectangle(bar_x, 36, bar_x + bar_w, 44,
                                  fill=P["panel"], outline=P["border"])
                fill_w = int(bar_w * task["progress"] / 100)
                if fill_w > 0:
                    c.create_rectangle(bar_x, 36, bar_x + fill_w, 44,
                                      fill=P["emerald"], outline="")
                c.create_text(bar_x + bar_w + 4, 40, text=f"{task['progress']}%",
                             font=F_PIXEL, fill=P["text_bright"], anchor="w")
                steps = task.get("steps", [])
                si = task.get("_step_idx", 0)
                if si < len(steps):
                    c.create_text(w - 280, 52, text=f"\u25B8 {steps[si][0]}",
                                 font=F_PIXEL, fill=P["amethyst"], anchor="w")

            if pipeline_live:
                # ── Pipeline 9-stage segmented progress bar ──
                pipe_y = 60 if has_task else 22
                c.create_text(w - 280, pipe_y,
                             text="AI PIPELINE", font=F_PIXEL,
                             fill=P["heading"], anchor="w")
                # Live dot
                dot_pulse = abs(math.sin(t * 4))
                dot_r = 2 + int(dot_pulse * 2)
                dot_x = w - 225
                c.create_oval(dot_x - dot_r, pipe_y - dot_r,
                             dot_x + dot_r, pipe_y + dot_r,
                             fill=P["emerald"], outline="")
                # Elapsed time
                c.create_text(w - 30, pipe_y,
                             text=f"{self.pipeline.elapsed_time:.1f}s",
                             font=F_PIXEL, fill=P["text_dim"], anchor="e")
                # Retry counter
                if self.pipeline.retry_count > 0:
                    c.create_text(w - 70, pipe_y,
                                 text=f"R{self.pipeline.retry_count}",
                                 font=F_PIXEL, fill=P["warn"], anchor="e")

                # Segmented bar
                bar_x = w - 280
                bar_y = pipe_y + 10
                bar_w = 250
                bar_h = 10
                nodes = PipelineSimulator.NODES
                seg_w = bar_w / len(nodes)
                c.create_rectangle(bar_x, bar_y, bar_x + bar_w, bar_y + bar_h,
                                  fill=P["panel_alt"], outline=P["border"])
                # Current active stage info
                active_stage_label = ""
                active_stage_color = P["text_dim"]
                active_stage_metric = ""
                for si, (nid, lbl, ck, _) in enumerate(nodes):
                    sx = bar_x + si * seg_w
                    state = self.pipeline.node_states.get(nid, "idle")
                    if state == "done":
                        c.create_rectangle(sx, bar_y, sx + seg_w, bar_y + bar_h,
                                          fill=P["ok"], outline="")
                    elif state == "active":
                        fill_frac = abs(math.sin(t * 3))
                        c.create_rectangle(sx, bar_y, sx + seg_w * fill_frac,
                                          bar_y + bar_h,
                                          fill=P.get(ck, P["cyan"]), outline="")
                        active_stage_label = lbl.replace("\n", " ")
                        active_stage_color = P.get(ck, P["cyan"])
                        active_stage_metric = self.pipeline.metrics.get(nid, "")
                    elif state in ("error", "retry"):
                        c.create_rectangle(sx, bar_y, sx + seg_w, bar_y + bar_h,
                                          fill=P["err"] if state == "error" else P["warn"],
                                          outline="")
                    # Segment divider
                    if si > 0:
                        c.create_line(sx, bar_y, sx, bar_y + bar_h,
                                     fill=P["border"], width=1)

                # Done count
                done_count = sum(1 for s in self.pipeline.node_states.values()
                                if s == "done")
                c.create_text(bar_x + bar_w + 4, bar_y + bar_h // 2,
                             text=f"{done_count}/{len(nodes)}", font=F_PIXEL,
                             fill=P["text_dim"], anchor="w")

                # Active stage label + metric
                if active_stage_label:
                    c.create_text(w - 280, bar_y + bar_h + 10,
                                 text=f"\u25C6 {active_stage_label}",
                                 font=F_SMALL, fill=active_stage_color, anchor="w")
                    if active_stage_metric:
                        c.create_text(w - 280, bar_y + bar_h + 24,
                                     text=active_stage_metric[:40],
                                     font=F_PIXEL, fill=P["text_dim"], anchor="w")
        else:
            idle_pulse = abs(math.sin(t * 0.8))
            col = P["text_dim"] if idle_pulse < 0.5 else P["cyan_dim"]
            # Rotating idle status messages
            idle_msgs = [
                "NEURAL NET STANDBY \u2014 monitoring vault",
                "HIVE ACTIVE \u2014 passive pattern scan",
                "DEEP IDLE \u2014 semantic index running",
                "AWAITING INPUT \u2014 knowledge graph live",
            ]
            msg_idx = int(t / 5) % len(idle_msgs)
            c.create_text(w // 2, h - 25, text=idle_msgs[msg_idx],
                         font=F_SMALL, fill=col)
            # Live neural stats
            active_n = sum(1 for n in self._ai_neurons if n["activation"] > 0.2)
            pulse_count = len(self._ai_pulses)
            stats_col = P["border_glow"]
            c.create_text(w - 10, 10, text=f"neurons: {active_n}/{len(self._ai_neurons)}  pulses: {pulse_count}",
                         font=F_PIXEL, fill=stats_col, anchor="ne")

        # Title with glow
        c.create_text(w // 2 + 1, h - 7, text="SHUMILEK HIVE NEURAL VIEW",
                     font=F_PIXEL, fill=P["border"])
        c.create_text(w // 2, h - 8, text="SHUMILEK HIVE NEURAL VIEW",
                     font=F_PIXEL, fill=P["border_glow"])

        # Thought bubbles (with glow outline)
        new_thoughts = []
        for tb in self._ai_thought_bubbles:
            tb["life"] += 1
            if tb["life"] < tb["max_life"]:
                new_thoughts.append(tb)
                bx = int(tb["x"] * w)
                by = int(tb["y"] * h) - int(tb["life"] * 0.3)
                fade = 1.0 - tb["life"] / tb["max_life"]
                if fade > 0.1:
                    col = _hex_color_scale(tb["color"], fade)
                    gcol = _hex_color_scale(tb["color"], fade * 0.25)
                    tw = len(tb["text"]) * 5 + 12
                    c.create_rectangle(bx - tw // 2 - 2, by - 10,
                                      bx + tw // 2 + 2, by + 10,
                                      fill=gcol, outline="")
                    # Bubble background
                    c.create_rectangle(bx - tw // 2, by - 8,
                                      bx + tw // 2, by + 8,
                                      fill=P["surface"], outline=col, width=1)
                    c.create_text(bx, by, text=tb["text"],
                                 font=F_PIXEL, fill=col)
        self._ai_thought_bubbles = new_thoughts

        # Knowledge score display
        ks = self._ai_knowledge_score
        if ks > 0:
            ks_col = P["emerald"] if ks >= 70 else (P["ice"] if ks >= 40 else P["ember"])
            c.create_text(10, h - 10, text=f"Knowledge: {ks}/100",
                         font=F_PIXEL, fill=ks_col, anchor="w")

        # Vignette overlay — dark edges for cinematic depth
        _draw_vignette(c, w, h, size=40)

    def _show_hive(self):
        """Switch to Hive view."""
        self._hide_all_views()
        self.hive_frame.pack(fill="both", expand=True, padx=4, pady=4)
        self.view_mode = "hive"
        self.view_indicator.config(text="HIVE", fg=P["emerald"])
        self.status_left.config(text="AI Hive \u2014 neural view + task queue")
        self.hive_task_entry.focus_set()
        self.root.after(50, self._hive_draw)

    # ─── AI AUTO-ANALYSIS ON SAVE ────────────────────────────────

    def _ai_on_save_analysis(self):
        """Silently analyze the saved note and log AI activity."""
        if not self.current_file:
            return
        content = self._read_cached(self.current_file)
        if not content:
            return
        name = self.current_file.stem
        words = len(content.split())
        lines = content.count("\n") + 1
        links = len(re.findall(r'\[\[([^\]]+)\]\]', content))
        headings = len(re.findall(r'^#{1,3}\s', content, re.MULTILINE))
        tags = len(re.findall(r'(?:^|\s)#(\w[\w-]+)', content))
        tasks_done = len(re.findall(r'- \[x\]', content))
        tasks_total = len(re.findall(r'- \[[ x]\]', content))

        # Log the analysis
        self._ai_log("info", f"Auto-scan: '{name}' saved")
        self._ai_log("think", f"  {words}w / {lines}L / {links} links / {headings} headings")
        if tags:
            self._ai_log("think", f"  {tags} tags detected")
        if tasks_total:
            self._ai_log("ok" if tasks_done == tasks_total else "warn",
                        f"  Tasks: {tasks_done}/{tasks_total} complete")

        # Detect quality issues
        if words < 20:
            self._ai_log("warn", f"  \u26A0 Note is very short ({words} words)")
            self._ai_add_thought("Short note detected")
        if headings == 0 and words > 50:
            self._ai_log("warn", f"  \u26A0 No headings found — add structure")
            self._ai_add_thought("Missing headings")
        if links == 0 and words > 30:
            self._ai_log("warn", f"  \u26A0 No links — consider connecting to other notes")
            self._ai_add_thought("Isolated note")
        if links > 5:
            self._ai_log("ok", f"  Well-connected note ({links} links)")
            self._ai_add_thought("Hub note!")

        # Pulse neurons briefly
        for neuron in self._ai_neurons:
            if neuron["layer"] == "input":
                neuron["activation"] = random.uniform(0.3, 0.6)

        # Update knowledge score
        self._ai_update_knowledge_score()

    def _ai_add_thought(self, text: str):
        """Add a floating thought bubble to the hive visualization."""
        self._ai_thought_bubbles.append({
            "text": text,
            "x": random.uniform(0.2, 0.8),  # normalized position
            "y": random.uniform(0.15, 0.5),
            "life": 0,
            "max_life": 80,
            "color": random.choice([P["cyan"], P["amethyst"], P["ice"], P["emerald"]]),
        })
        if len(self._ai_thought_bubbles) > 8:
            self._ai_thought_bubbles = self._ai_thought_bubbles[-8:]

    # ─── KNOWLEDGE SCORE ─────────────────────────────────────────

    def _ai_update_knowledge_score(self):
        """Compute and display vault knowledge quality score."""
        files = list(self.vault_path.glob("**/*.md"))
        if not files:
            self._ai_knowledge_score = 0
            self._ks_render(0, "No notes yet")
            return

        total_score = 0
        details = []

        # Score components
        note_count = len(files)
        total_words = 0
        total_links = 0
        total_headings = 0
        total_tags = 0
        connected_notes = set()
        all_stems = {f.stem for f in files}

        for f in files:
            content = self._read_cached(f)
            if not content:
                continue
            words = len(content.split())
            total_words += words
            lnks = re.findall(r'\[\[([^\]]+)\]\]', content)
            total_links += len(lnks)
            total_headings += len(re.findall(r'^#{1,3}\s', content, re.MULTILINE))
            total_tags += len(re.findall(r'(?:^|\s)#(\w[\w-]+)', content))
            for ln in lnks:
                connected_notes.add(f.stem)
                connected_notes.add(ln)

        # Calculate component scores (out of 100)
        coverage = min(100, note_count * 10)  # 10 notes = full coverage score
        depth = min(100, total_words // max(note_count, 1) // 2)  # avg 200 words = full
        connectivity = min(100, int(len(connected_notes) / max(len(all_stems), 1) * 100))
        structure = min(100, int(total_headings / max(note_count, 1) * 40))
        tagging = min(100, total_tags * 15)

        weights = {"Coverage": (coverage, 0.25), "Depth": (depth, 0.25),
                   "Connectivity": (connectivity, 0.25), "Structure": (structure, 0.15),
                   "Tagging": (tagging, 0.10)}

        total_score = int(sum(s * w for s, w in weights.values()))
        self._ai_knowledge_score = total_score

        detail_parts = [f"{k}: {s}" for k, (s, _) in weights.items()]
        self._ks_render(total_score, " | ".join(detail_parts))

    def _ks_render(self, score: int, detail: str):
        """Render the knowledge score bar and label."""
        c = self.ks_bar_canvas
        c.delete("all")
        w = max(c.winfo_width(), 200)

        # Background bar
        c.create_rectangle(4, 4, w - 4, 16, fill=P["panel"], outline=P["border"])

        # Fill bar
        fill_w = int((w - 8) * score / 100)
        if fill_w > 0:
            if score >= 70:
                fill_col = P["emerald"]
            elif score >= 40:
                fill_col = P["ice"]
            else:
                fill_col = P["ember"]
            c.create_rectangle(4, 4, 4 + fill_w, 16, fill=fill_col, outline="")

        # Score tick marks
        for tick in [25, 50, 75]:
            tx = 4 + int((w - 8) * tick / 100)
            c.create_line(tx, 4, tx, 16, fill=P["border_glow"], width=1)

        self.ks_score_label.config(text=f"{score} / 100")
        self.ks_details_label.config(text=detail)

    # ─── RELATED NOTES ───────────────────────────────────────────

    def _update_related_notes(self):
        """Find notes related to the current note by keyword + link overlap."""
        self.related_listbox.delete(0, "end")
        if not self.current_file:
            return
        content = self._read_cached(self.current_file)
        if not content:
            return

        cur_stem = self.current_file.stem
        cur_words = set(w.lower() for w in re.findall(r'\b[a-zA-Z]{4,}\b', content))
        cur_tags = set(re.findall(r'#(\w[\w-]+)', content))
        cur_links = set(re.findall(r'\[\[([^\]]+)\]\]', content))

        scores: list[tuple[float, str]] = []
        for fp in self.vault_path.glob("**/*.md"):
            if fp.stem == cur_stem:
                continue
            other = self._read_cached(fp)
            if not other:
                continue
            other_words = set(w.lower() for w in re.findall(r'\b[a-zA-Z]{4,}\b', other))
            other_tags = set(re.findall(r'#(\w[\w-]+)', other))
            other_links = set(re.findall(r'\[\[([^\]]+)\]\]', other))

            word_overlap = len(cur_words & other_words) / max(len(cur_words | other_words), 1)
            tag_overlap = len(cur_tags & other_tags) * 0.3
            link_bonus = 0.4 if fp.stem in cur_links or cur_stem in other_links else 0
            mutual_links = len(cur_links & other_links) * 0.15

            score = word_overlap + tag_overlap + link_bonus + mutual_links
            if score > 0.05:
                scores.append((score, fp.stem))

        scores.sort(reverse=True)
        for score, name in scores[:5]:
            bar = "\u2588" * min(int(score * 8), 6)
            self.related_listbox.insert("end", f"  {bar} {name}")

    def _on_related_select(self, event):
        sel = self.related_listbox.curselection()
        if not sel:
            return
        text = self.related_listbox.get(sel[0]).strip()
        # Extract name after the bar chars
        name = re.sub(r'^[\u2588\s]+', '', text).strip()
        path = self.vault_path / f"{name}.md"
        if path.exists():
            self._open_file(path)

    # ─── RECENT FILES ────────────────────────────────────────────

    def _refresh_recent_files(self):
        """Update the recent files listbox."""
        self.recent_listbox.delete(0, "end")
        for path in self._recent_files[:5]:
            if path.exists():
                self.recent_listbox.insert("end", f"  \u25B8 {path.stem}")

    def _on_recent_select(self, event):
        sel = self.recent_listbox.curselection()
        if not sel:
            return
        idx = sel[0]
        existing = [p for p in self._recent_files[:5] if p.exists()]
        if idx < len(existing):
            self._open_file(existing[idx])

    # ─── NOTE MOOD / TONE INDICATOR ──────────────────────────────

    def _update_mood_indicator(self):
        """Analyze note text tone and show indicator in status bar."""
        if not self.current_file:
            self.status_mood.config(text="")
            return
        try:
            content = self.editor.get("1.0", "end-1c").lower()
        except Exception:
            self.status_mood.config(text="")
            return

        positive = {"good", "great", "love", "happy", "excellent", "amazing",
                     "beautiful", "perfect", "awesome", "wonderful", "best",
                     "success", "win", "complete", "done", "solved", "nice",
                     "cool", "fun", "enjoy", "bright", "hope", "inspire"}
        negative = {"bad", "wrong", "fail", "error", "bug", "broken", "issue",
                     "problem", "ugly", "terrible", "worst", "hate", "sad",
                     "missing", "lost", "stuck", "crash", "warning", "danger",
                     "difficult", "hard", "pain", "slow", "confusing"}
        technical = {"function", "class", "method", "code", "data", "system",
                      "process", "config", "deploy", "build", "test", "api",
                      "server", "debug", "module", "script", "variable"}
        creative = {"story", "character", "world", "magic", "adventure",
                     "quest", "dragon", "spell", "lore", "forest", "crystal",
                     "ancient", "pixel", "art", "color", "design", "dream"}

        words = set(re.findall(r'\b[a-z]{3,}\b', content))
        p = len(words & positive)
        n = len(words & negative)
        t = len(words & technical)
        cr = len(words & creative)

        best = max(p, n, t, cr)
        if best == 0:
            self.status_mood.config(text="\u2726 neutral", fg=P["text_dim"])
        elif best == cr:
            self.status_mood.config(text="\u2728 creative", fg=P["amethyst"])
        elif best == t:
            self.status_mood.config(text="\u2699 technical", fg=P["ice"])
        elif best == p:
            self.status_mood.config(text="\u2764 positive", fg=P["emerald"])
        else:
            self.status_mood.config(text="\u26A1 intense", fg=P["ember"])

    # ─── FOCUS MODE ──────────────────────────────────────────────

    def _toggle_focus_mode(self):
        """Toggle distraction-free writing mode: hide sidebar + right panel."""
        self._focus_mode = not self._focus_mode
        if self._focus_mode:
            self.sidebar.grid_remove()
            self.right_panel.grid_remove()
            self.view_indicator.config(text="FOCUS", fg=P["emerald"])
            self.status_left.config(text="focus mode \u2014 Ctrl+Shift+Z to exit")
            if self.view_mode != "editor":
                self._show_editor()
        else:
            self.sidebar.grid()
            self.right_panel.grid()
            self.view_indicator.config(text="EDITOR", fg=P["cyan_dim"])
            self.status_left.config(text="editor view")

    # ─── VAULT TIMELINE VIEW ─────────────────────────────────────

    def _show_timeline(self):
        """Switch to timeline view showing note creation/modification dates."""
        self._hide_all_views()
        self.timeline_frame.pack(fill="both", expand=True, padx=4, pady=4)
        self.view_mode = "timeline"
        self.view_indicator.config(text="TIMELINE", fg=P["rose"])
        self.status_left.config(text="vault timeline \u2014 click event to open note")
        self.root.after(50, self._draw_timeline)

    def _draw_timeline(self):
        """Draw a visual timeline of vault notes by modification date."""
        c = self.timeline_canvas
        c.delete("all")
        w = max(c.winfo_width(), 600)
        h = max(c.winfo_height(), 400)

        files = list(self.vault_path.glob("**/*.md"))
        if not files:
            c.create_text(w // 2, h // 2, text="No notes yet",
                         font=F_TITLE, fill=P["text_dim"])
            return

        # Grid background
        for gx in range(0, w, 50):
            c.create_line(gx, 0, gx, h, fill="#0C0920", width=1)
        for gy in range(0, h, 50):
            c.create_line(0, gy, w, gy, fill="#0C0920", width=1)

        # Gather file info sorted by mod time
        entries = []
        for fp in files:
            try:
                stat = fp.stat()
                entries.append((fp, stat.st_mtime, stat.st_size))
            except Exception:
                continue
        entries.sort(key=lambda e: e[1])

        if not entries:
            return

        # Time range
        t_min = entries[0][1]
        t_max = entries[-1][1]
        t_range = max(t_max - t_min, 1)

        # Header
        c.create_text(10, 12, text="Vault Timeline", font=F_HEAD,
                     fill=P["heading"], anchor="nw")
        c.create_text(10, 30, text=f"{len(entries)} notes",
                     font=F_PIXEL, fill=P["text_dim"], anchor="nw")

        # Timeline axis
        axis_y = h - 50
        margin_x = 60
        axis_w = w - 2 * margin_x
        c.create_line(margin_x, axis_y, w - margin_x, axis_y,
                     fill=P["border_glow"], width=2)

        # Date labels on axis
        if len(entries) >= 2:
            for frac in [0.0, 0.25, 0.5, 0.75, 1.0]:
                ts = t_min + t_range * frac
                dt = datetime.datetime.fromtimestamp(ts)
                tx = margin_x + int(axis_w * frac)
                c.create_line(tx, axis_y - 3, tx, axis_y + 3,
                             fill=P["text_dim"], width=1)
                c.create_text(tx, axis_y + 14, text=dt.strftime("%m/%d"),
                             font=F_PIXEL, fill=P["text_dim"])

        # Plot notes as events
        self._timeline_positions = {}
        lane_h = max((axis_y - 60) // max(len(entries), 1), 18)
        for i, (fp, mtime, size) in enumerate(entries):
            frac = (mtime - t_min) / t_range if t_range > 1 else 0.5
            x = margin_x + int(axis_w * frac)
            y = 55 + (i % max(1, (axis_y - 60) // 22)) * 22

            # Drop line to axis
            c.create_line(x, y + 6, x, axis_y, fill=P["border"], width=1, dash=(2, 4))

            # Event dot — size by file size
            dot_r = max(4, min(10, int(size / 200)))
            words = size // 5  # rough estimate
            if words > 200:
                col = P["emerald"]
            elif words > 50:
                col = P["ice"]
            else:
                col = P["amethyst_dim"]

            # Glow
            c.create_oval(x - dot_r - 3, y - dot_r - 3,
                         x + dot_r + 3, y + dot_r + 3,
                         fill="", outline=col, width=1, dash=(2, 2))
            c.create_oval(x - dot_r, y - dot_r, x + dot_r, y + dot_r,
                         fill=col, outline=P["border_glow"])

            # Label
            dt = datetime.datetime.fromtimestamp(mtime)
            c.create_text(x + dot_r + 6, y, text=fp.stem,
                         font=F_SMALL, fill=P["text"], anchor="w")
            c.create_text(x + dot_r + 6, y + 11, text=dt.strftime("%H:%M"),
                         font=F_PIXEL, fill=P["text_dim"], anchor="w")

            self._timeline_positions[fp.stem] = (x, y, dot_r + 8, fp)

        # Footer
        c.create_text(w // 2, h - 10, text="SHUMILEK VAULT TIMELINE",
                     font=F_PIXEL, fill=P["border_glow"])

    def _on_timeline_click(self, event):
        """Open note clicked on the timeline."""
        for name, (nx, ny, r, fp) in self._timeline_positions.items():
            if abs(event.x - nx) < r + 20 and abs(event.y - ny) < 15:
                if fp.exists():
                    self._show_editor()
                    self._open_file(fp)
                return

    # ─── NOTE VERSION SNAPSHOTS ──────────────────────────────────

    def _take_snapshot(self):
        """Save a snapshot of the current note content."""
        if not self.current_file:
            self.status_left.config(text="no file open to snapshot")
            return
        content = self.editor.get("1.0", "end-1c")
        stem = self.current_file.stem
        ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        if stem not in self._note_snapshots:
            self._note_snapshots[stem] = []
        self._note_snapshots[stem].append((ts, content))
        # Keep max 10 snapshots per note
        if len(self._note_snapshots[stem]) > 10:
            self._note_snapshots[stem] = self._note_snapshots[stem][-10:]
        count = len(self._note_snapshots[stem])
        self.status_left.config(text=f"snapshot #{count} saved for '{stem}'")
        self._ai_log("ok", f"Snapshot #{count} for '{stem}'")

    def _show_snapshots(self):
        """Show snapshot list for the current note in a dialog."""
        if not self.current_file:
            return
        stem = self.current_file.stem
        snaps = self._note_snapshots.get(stem, [])
        if not snaps:
            messagebox.showinfo("Snapshots", f"No snapshots for '{stem}'.\nUse Ctrl+Shift+S to save one.")
            return

        win = tk.Toplevel(self.root)
        win.title(f"Snapshots — {stem}")
        win.geometry("500x400")
        win.configure(bg=P["panel"])
        self._prepare_modal(win)

        tk.Label(win, text=f"SNAPSHOTS: {stem}", font=F_HEAD,
                 fg=P["heading"], bg=P["panel"]).pack(pady=(10, 4))
        tk.Label(win, text=f"{len(snaps)} snapshots saved", font=F_PIXEL,
                 fg=P["text_dim"], bg=P["panel"]).pack()

        listbox = tk.Listbox(win, font=F_MONO, bg=P["panel"], fg=P["text"],
                             selectbackground=P["surface"], selectforeground=P["cyan"],
                             activestyle="none", bd=0, highlightthickness=0)
        listbox.pack(fill="both", expand=True, padx=10, pady=6)
        for i, (ts, content) in enumerate(snaps):
            words = len(content.split())
            listbox.insert("end", f"  #{i+1}  {ts}  ({words}w)")

        preview = tk.Text(win, font=F_SMALL, bg=P["surface"], fg=P["text"],
                          height=8, bd=0, padx=6, pady=4, wrap="word",
                          highlightthickness=0)
        preview.pack(fill="x", padx=10, pady=(0, 6))

        def on_select(event):
            sel = listbox.curselection()
            if sel:
                _, content = snaps[sel[0]]
                preview.config(state="normal")
                preview.delete("1.0", "end")
                preview.insert("1.0", content[:2000])
                preview.config(state="disabled")

        listbox.bind("<<ListboxSelect>>", on_select)

        btn_frame = tk.Frame(win, bg=P["panel"])
        btn_frame.pack(fill="x", padx=10, pady=(0, 10))

        def restore():
            sel = listbox.curselection()
            if not sel:
                return
            _, content = snaps[sel[0]]
            self.editor.delete("1.0", "end")
            self.editor.insert("1.0", content)
            self.modified = True
            if self._active_tab_idx >= 0 and self._active_tab_idx < len(self._open_tabs):
                self._open_tabs[self._active_tab_idx]["modified"] = True
                self._rebuild_tab_bar()
            self.status_left.config(text=f"restored snapshot #{sel[0]+1}")
            win.destroy()

        tk.Button(btn_frame, text="Restore selected", font=F_SMALL,
                  fg=P["emerald"], bg=P["surface"],
                  activebackground=P["hover"], bd=0,
                  command=restore, cursor="hand2").pack(side="left")
        tk.Button(btn_frame, text="Close", font=F_SMALL,
                  fg=P["cyan"], bg=P["surface"],
                  activebackground=P["hover"], bd=0,
                  command=win.destroy, cursor="hand2").pack(side="right")

    # ─── GRAPH DRAG INTERACTION ──────────────────────────────────

    def _on_graph_drag(self, event):
        """Drag a graph node to reposition it."""
        if self.view_mode != "graph":
            return
        if self._graph_press_node is None:
            return
        if self._graph_press_xy is not None and not self._graph_dragged:
            px, py = self._graph_press_xy
            if (event.x - px)**2 + (event.y - py)**2 < 36:
                return
        self._graph_dragged = True
        if self._graph_drag_node is None:
            self._graph_drag_node = self._graph_press_node
        if self._graph_drag_node:
            try:
                self._graph_custom_positions[self._graph_drag_node] = (event.x, event.y)
                self._draw_graph()
            except Exception:
                self._graph_drag_node = None
                self._graph_press_node = None
                self._graph_press_xy = None
                self._graph_dragged = False

    def _on_graph_release(self, event):
        """Release dragged graph node."""
        released_node = None
        for node, (nx, ny, r) in self._graph_node_positions.items():
            if (event.x - nx)**2 + (event.y - ny)**2 <= (r + 5)**2:
                released_node = node
                break
        if not self._graph_dragged and self._graph_press_node and released_node == self._graph_press_node:
            target = self.vault_path / f"{released_node}.md"
            if target.exists():
                self._show_editor()
                self._open_file(target)
        self._graph_drag_node = None
        self._graph_press_node = None
        self._graph_press_xy = None
        self._graph_dragged = False

    def _on_graph_hover(self, event):
        """Show tooltip when hovering a graph node."""
        if self._graph_drag_node:
            self.graph_tooltip.place_forget()
            return
        for node, (nx, ny, r) in self._graph_node_positions.items():
            if (event.x - nx)**2 + (event.y - ny)**2 <= (r + 6)**2:
                importance = self._compute_note_importance()
                imp = importance.get(node, 0.0)
                out_c = len(self.notes_graph.get(node, set()))
                in_c = sum(1 for tgts in self.notes_graph.values() if node in tgts)
                conn = out_c + in_c
                fp = self.vault_path / f"{node}.md"
                words = 0
                if fp.exists():
                    words = len(self._read_cached(fp).split())
                tip = f"{node}\n{words}w \u00b7 {conn} links \u00b7 imp {imp:.0%}"
                # AI activity info
                if node in self._graph_ai_active_nodes:
                    ai_info = self._graph_ai_active_nodes[node]
                    stage_names = {
                        "context": "Context Scan", "routing": "Input Routing",
                        "rozum": "AI Planning", "generate": "Generating",
                        "guardian": "Quality Check", "halluc": "Halluc Detect",
                        "svedomi": "Validating", "decision": "Deciding",
                        "output": "Delivering",
                    }
                    stage_name = stage_names.get(ai_info["stage"], ai_info["stage"])
                    tip += f"\n\u26A1 AI: {stage_name} ({ai_info['intensity']:.0%})"
                self.graph_tooltip.config(text=tip)
                tx = min(event.x + 14, self.graph_canvas.winfo_width() - 230)
                ty = max(event.y - 50, 4)
                self.graph_tooltip.place(x=tx, y=ty)
                return
        self.graph_tooltip.place_forget()

    def _on_graph_right_click(self, event):
        """Show context menu on graph node right-click."""
        for node, (nx, ny, r) in self._graph_node_positions.items():
            if (event.x - nx)**2 + (event.y - ny)**2 <= (r + 6)**2:
                self._graph_ctx_node = node
                self.graph_ctx_menu.tk_popup(event.x_root, event.y_root)
                return

    def _graph_ctx_open(self):
        """Open the right-clicked graph node in editor."""
        if not self._graph_ctx_node:
            return
        target = self.vault_path / f"{self._graph_ctx_node}.md"
        if target.exists():
            self._show_editor()
            self._open_file(target)

    def _graph_ctx_pin(self):
        """Toggle pin for right-clicked graph node."""
        if not self._graph_ctx_node:
            return
        stem = self._graph_ctx_node
        if stem in self._pinned_notes:
            self._pinned_notes.discard(stem)
            self._show_toast(f"Unpinned: {stem}")
        else:
            self._pinned_notes.add(stem)
            self._show_toast(f"\u2605 Pinned: {stem}")
        self._save_pinned()
        self._refresh_file_tree()

    def _graph_ctx_rename(self):
        """Rename right-clicked graph node."""
        if not self._graph_ctx_node:
            return
        target = self.vault_path / f"{self._graph_ctx_node}.md"
        if target.exists():
            self._open_file(target)
            self._rename_note()

    def _graph_ctx_links(self):
        """Show link info for right-clicked graph node via toast."""
        if not self._graph_ctx_node:
            return
        node = self._graph_ctx_node
        out = self.notes_graph.get(node, set())
        inc = {n for n, tgts in self.notes_graph.items() if node in tgts}
        msg = f"{node}: {len(out)} outgoing, {len(inc)} incoming links"
        self._show_toast(msg, duration_ms=4000)

    # ─── ENHANCED GRAPH VIEW (HEAT MAP) ──────────────────────────

    def _compute_note_importance(self) -> dict[str, float]:
        """Compute importance score for each note (0.0 - 1.0). Cached for 3s."""
        now = time.time()
        if self._importance_cache and now - self._importance_cache_time < 3.0:
            return self._importance_cache
        importance: dict[str, float] = {}
        files = list(self.vault_path.glob("**/*.md"))
        if not files:
            return importance

        max_score = 1.0
        for f in files:
            name = f.stem
            content = self._read_cached(f)
            if not content:
                importance[name] = 0.0
                continue

            words = len(content.split())
            links_out = len(_RE_WIKILINK.findall(content))
            headings = len(_RE_HEADING.findall(content))

            # Incoming links from graph
            links_in = 0
            for src, targets in self.notes_graph.items():
                if name in targets:
                    links_in += 1

            score = (
                min(words / 300, 1.0) * 0.3 +
                min(links_out / 5, 1.0) * 0.2 +
                min(links_in / 3, 1.0) * 0.3 +
                min(headings / 3, 1.0) * 0.2
            )
            importance[name] = score
            max_score = max(max_score, score)

        # Normalize
        if max_score > 0:
            for k in importance:
                importance[k] /= max_score

        # Cap cache size for large vaults
        if len(importance) > self._IMPORTANCE_CACHE_MAX:
            # Keep top entries by score
            sorted_keys = sorted(importance, key=importance.get, reverse=True)
            importance = {k: importance[k] for k in sorted_keys[:self._IMPORTANCE_CACHE_MAX]}
        self._importance_cache = importance
        self._importance_cache_time = now
        return importance

    # ─── ZOOM ─────────────────────────────────────────────────
    def _zoom_in(self):
        if self._zoom_level < 8:
            self._zoom_level += 1
            self._apply_zoom()

    def _zoom_out(self):
        if self._zoom_level > -4:
            self._zoom_level -= 1
            self._apply_zoom()

    def _zoom_reset(self):
        self._zoom_level = 0
        self._apply_zoom()

    def _on_ctrl_scroll(self, event):
        if event.delta > 0:
            self._zoom_in()
        else:
            self._zoom_out()

    def _apply_zoom(self):
        base = 11 + self._zoom_level
        self.editor.config(font=(FONT, base))
        self.line_numbers.config(font=(FONT, base))
        self.preview_text.config(font=(FONT, base))
        # Re-apply tag fonts scaled
        self.editor.tag_configure("heading1", font=(FONT, base + 7, "bold"))
        self.editor.tag_configure("heading2", font=(FONT, base + 4, "bold"))
        self.editor.tag_configure("heading3", font=(FONT, base + 1, "bold"))
        self.editor.tag_configure("bold", font=(FONT, base, "bold"))
        self.editor.tag_configure("italic", font=(FONT, base, "italic"))
        self.editor.tag_configure("code", font=(FONT, base - 1))
        self.preview_text.tag_configure("h1", font=(FONT, base + 11, "bold"))
        self.preview_text.tag_configure("h2", font=(FONT, base + 5, "bold"))
        self.preview_text.tag_configure("h3", font=(FONT, base + 2, "bold"))
        self.status_left.config(text=f"Zoom: {base}pt")
        self._update_line_numbers()

    def _on_canvas_resize(self, canvas_name: str):
        """Redraw canvas content when its size changes."""
        if canvas_name == "graph":
            cw, ch = self.graph_canvas.winfo_width(), self.graph_canvas.winfo_height()
        elif canvas_name == "schema":
            cw, ch = self.schema_canvas.winfo_width(), self.schema_canvas.winfo_height()
        elif canvas_name == "hive":
            cw, ch = self.hive_canvas.winfo_width(), self.hive_canvas.winfo_height()
        elif canvas_name == "timeline":
            cw, ch = self.timeline_canvas.winfo_width(), self.timeline_canvas.winfo_height()
        elif canvas_name == "cards":
            cw, ch = self.cards_canvas.winfo_width(), self.cards_canvas.winfo_height()
        else:
            return
        prev = self._last_canvas_size.get(canvas_name)
        if prev == (cw, ch) or cw < 20 or ch < 20:
            return
        self._last_canvas_size[canvas_name] = (cw, ch)
        if self.view_mode == "graph" and canvas_name == "graph":
            self._draw_graph()
        elif self.view_mode == "schema" and canvas_name == "schema":
            self._draw_schema()
        elif self.view_mode == "hive" and canvas_name == "hive":
            self._hive_draw()
        elif self.view_mode == "timeline" and canvas_name == "timeline":
            self._draw_timeline()
        elif self.view_mode == "cards" and canvas_name == "cards":
            self._draw_cards()

    def _show_shortcuts(self):
        shortcuts = [
            ("Ctrl+N", "New note"),
            ("Ctrl+S", "Save note"),
            ("Ctrl+F", "Toggle search"),
            ("Ctrl+Shift+F", "Vault-wide search"),
            ("Ctrl+E", "Editor view"),
            ("Ctrl+R", "Preview view"),
            ("Ctrl+G", "Graph view"),
            ("Ctrl+P", "Pipeline schema"),
            ("Ctrl+Shift+E", "Export to HTML"),
            ("Ctrl+K", "AI command palette"),
            ("Ctrl+H", "Hive AI view"),
            ("Ctrl+T", "Timeline view"),
            ("Ctrl+Shift+S", "Save note snapshot"),
            ("Ctrl+Shift+Z", "Focus mode (distraction-free)"),
            ("Ctrl+Shift+P", "Command palette"),
            ("Ctrl+W", "Close active tab"),
            ("Ctrl+Tab", "Next tab"),
            ("Ctrl+Shift+Tab", "Previous tab"),
            ("Ctrl+Shift+X", "Export task history"),
            ("Ctrl+/Ctrl-", "Zoom in / out"),
            ("Ctrl+0", "Reset zoom"),
            ("Ctrl+Click", "Follow [[wiki-link]]"),
            ("Click [x]/[ ]", "Toggle task checkbox"),
            ("[[", "Autocomplete wiki-link"),
            ("Delete", "Delete current note"),
            ("F1", "This help dialog"),
        ]
        win = tk.Toplevel(self.root)
        win.title("Keyboard Shortcuts")
        win.geometry("380x500")
        win.configure(bg=P["panel"])
        self._prepare_modal(win)
        tk.Label(win, text="KEYBOARD SHORTCUTS", font=F_HEAD,
                 fg=P["heading"], bg=P["panel"]).pack(pady=(16, 8))
        for key, desc in shortcuts:
            row = tk.Frame(win, bg=P["panel"])
            row.pack(fill="x", padx=20, pady=2)
            tk.Label(row, text=key, font=(FONT, 10, "bold"),
                     fg=P["cyan"], bg=P["panel"], width=14, anchor="w"
            ).pack(side="left")
            tk.Label(row, text=desc, font=F_SMALL,
                     fg=P["text"], bg=P["panel"], anchor="w"
            ).pack(side="left")
        sep = tk.Frame(win, bg=P["border"], height=1)
        sep.pack(fill="x", padx=20, pady=10)
        tk.Label(win, text="Auto-save: 5s after last edit", font=F_PIXEL,
                 fg=P["text_dim"], bg=P["panel"]).pack()
        tk.Label(win, text="Right-click file list for context menu", font=F_PIXEL,
                 fg=P["text_dim"], bg=P["panel"]).pack(pady=(2, 0))
        tk.Button(win, text="Close", font=F_SMALL,
                  fg=P["cyan"], bg=P["surface"],
                  activebackground=P["hover"], bd=0,
                  command=win.destroy, cursor="hand2"
        ).pack(pady=16)

    def _update_vault_stats(self):
        total_words = 0
        total_links = 0
        all_tags: set[str] = set()
        for fp in self._all_files:
            content = self._read_cached(fp)
            total_words += len(content.split())
            total_links += len(_RE_WIKILINK.findall(content))
            all_tags.update(_RE_TAG_BARE.findall(content))
        self.stat_labels["notes"].config(text=str(len(self._all_files)))
        self.stat_labels["words"].config(text=f"{total_words:,}")
        self.stat_labels["links"].config(text=str(total_links))
        self.stat_labels["tags"].config(text=str(len(all_tags)))
        self._ai_update_knowledge_score()

    def _maybe_save_then(self, cb):
        if self.modified and self.current_file:
            ans = messagebox.askyesnocancel("Save?", f"Save '{self.current_file.stem}'?")
            if ans is None:
                return
            if ans:
                self._save_note()
        cb()

    # ─── SYNTAX HIGHLIGHTING ─────────────────────────────────────
    def _apply_syntax(self):
        # Only process visible lines + small margin for smoother scrolling
        try:
            top_idx = self.editor.index("@0,0")
            bot_idx = self.editor.index(f"@0,{self.editor.winfo_height()}")
            first_vis = max(1, int(top_idx.split(".")[0]) - 5)
            last_vis = int(bot_idx.split(".")[0]) + 5
        except Exception:
            first_vis = 1
            last_vis = 9999

        # Clear tags only on visible range instead of entire document
        vis_start = f"{first_vis}.0"
        vis_end = f"{last_vis}.end"
        for tag in ("heading1", "heading2", "heading3", "bold", "italic",
                     "code", "link", "tag", "quote", "bullet", "hr",
                     "table_header", "task_done", "task_open"):
            self.editor.tag_remove(tag, vis_start, vis_end)

        content = self.editor.get("1.0", "end")
        lines = content.split("\n")
        for i, line in enumerate(lines):
            line_num = i + 1
            if line_num < first_vis or line_num > last_vis:
                continue

            ls = f"{line_num}.0"
            le = f"{line_num}.end"

            if line.startswith("### "):
                self.editor.tag_add("heading3", ls, le)
            elif line.startswith("## "):
                self.editor.tag_add("heading2", ls, le)
            elif line.startswith("# "):
                self.editor.tag_add("heading1", ls, le)
            elif line.startswith("> "):
                self.editor.tag_add("quote", ls, le)
            elif _RE_HR.match(line.strip()):
                self.editor.tag_add("hr", ls, le)
            elif _RE_TASK_DONE.match(line):
                self.editor.tag_add("task_done", ls, le)
            elif _RE_TASK_OPEN.match(line):
                self.editor.tag_add("task_open", ls, le)
            elif _RE_BULLET_LINE.match(line):
                m = _RE_BULLET.match(line)
                if m:
                    self.editor.tag_add("bullet", f"{line_num}.{m.start(2)}", f"{line_num}.{m.end(2)}")
            elif "|" in line and _RE_TABLE_ROW.match(line.strip()):
                if i + 1 < len(lines) and _RE_TABLE_SEP.match(lines[i+1].strip()):
                    self.editor.tag_add("table_header", ls, le)

            for m in _RE_WIKILINK.finditer(line):
                self.editor.tag_add("link", f"{line_num}.{m.start()}", f"{line_num}.{m.end()}")
            for m in _RE_TAG.finditer(line):
                if line.startswith("#"):
                    hm = _RE_HEADING_PREFIX.match(line)
                    if hm and m.start() < hm.end():
                        continue
                self.editor.tag_add("tag", f"{line_num}.{m.start()}", f"{line_num}.{m.end()}")
            for m in _RE_CODE_SPAN.finditer(line):
                self.editor.tag_add("code", f"{line_num}.{m.start()}", f"{line_num}.{m.end()}")
            for m in _RE_BOLD.finditer(line):
                self.editor.tag_add("bold", f"{line_num}.{m.start()}", f"{line_num}.{m.end()}")

    def _on_autocomplete_key(self, event):
        """Handle Tab to accept autocomplete when popup is visible."""
        if not self._autocomplete_visible:
            return
        sel = self._autocomplete_popup.curselection()
        if not sel:
            # Select first item if nothing selected
            if self._autocomplete_popup.size() > 0:
                self._autocomplete_popup.selection_set(0)
                sel = (0,)
            else:
                return
        self._on_autocomplete_select(None)
        return "break"

    def _on_key_release(self, event):
        if event.keysym in ("Shift_L", "Shift_R", "Control_L", "Control_R",
                            "Alt_L", "Alt_R", "Caps_Lock"):
            return
        # Autocomplete keyboard navigation
        if self._autocomplete_visible:
            if event.keysym == "Down":
                cur = self._autocomplete_popup.curselection()
                nxt = (cur[0] + 1) if cur else 0
                if nxt < self._autocomplete_popup.size():
                    self._autocomplete_popup.selection_clear(0, "end")
                    self._autocomplete_popup.selection_set(nxt)
                    self._autocomplete_popup.see(nxt)
                return
            elif event.keysym == "Up":
                cur = self._autocomplete_popup.curselection()
                nxt = (cur[0] - 1) if cur else 0
                if nxt >= 0:
                    self._autocomplete_popup.selection_clear(0, "end")
                    self._autocomplete_popup.selection_set(nxt)
                    self._autocomplete_popup.see(nxt)
                return
            elif event.keysym == "Return":
                self._on_autocomplete_select(None)
                return
            elif event.keysym == "Escape":
                self._hide_autocomplete()
                return
        # Debounce syntax highlighting (80ms)
        if self._syntax_after_id:
            self.root.after_cancel(self._syntax_after_id)
        self._syntax_after_id = self.root.after(80, self._deferred_syntax_update)
        self._update_line_numbers()
        self._update_cursor_pos()
        self._check_autocomplete()

    def _deferred_syntax_update(self):
        """Deferred syntax + minimap update after typing pause."""
        self._syntax_after_id = None
        self._apply_syntax()
        self._update_minimap()

    def _on_modified(self, event):
        if self.editor.edit_modified():
            self.modified = True
            if self._active_tab_idx >= 0 and self._active_tab_idx < len(self._open_tabs):
                tab = self._open_tabs[self._active_tab_idx]
                if not tab["modified"]:
                    tab["modified"] = True
                    self._rebuild_tab_bar()
            self._schedule_autosave()
            self._update_word_count()

    def _update_line_numbers(self):
        self.line_numbers.config(state="normal")
        self.line_numbers.delete("1.0", "end")
        n = int(self.editor.index("end-1c").split(".")[0])
        self.line_numbers.insert("1.0", "\n".join(str(i) for i in range(1, n + 1)))
        self.line_numbers.config(state="disabled")

    def _schedule_autosave(self):
        if self._autosave_id:
            self.root.after_cancel(self._autosave_id)
        self._autosave_id = self.root.after(5000, self._autosave)

    def _autosave(self):
        self._autosave_id = None
        if self.modified and self.current_file:
            self._save_note()
            self.status_left.config(text=f"auto-saved: {self.current_file.stem}")

    def _update_cursor_pos(self):
        """Update Ln/Col indicator in statusbar."""
        try:
            pos = self.editor.index("insert")
            ln, col = pos.split(".")
            self.status_cursor.config(text=f"Ln {ln} Col {int(col) + 1}")
        except Exception:
            pass

    def _update_word_count(self):
        content = self.editor.get("1.0", "end-1c")
        words = len(content.split())
        chars = len(content)
        lines = content.count("\n") + 1
        links = len(re.findall(r'\[\[[^\]]+\]\]', content))
        link_info = f"  {links}\U0001f517" if links > 0 else ""
        self.status_right.config(text=f"{words}w  {chars}c  {lines}L{link_info}")
        self._update_cursor_pos()
        # Reading time (avg 200 wpm)
        minutes = max(1, round(words / 200)) if words > 0 else 0
        if minutes > 0:
            self.status_reading_time.config(text=f"\u231a {minutes}min read")
        else:
            self.status_reading_time.config(text="")
        # Word goal progress
        if self._word_goal > 0:
            pct = min(100, int(words / self._word_goal * 100))
            bar_len = 8
            filled = int(bar_len * pct / 100)
            bar = "\u2588" * filled + "\u2591" * (bar_len - filled)
            color = P["ok"] if pct >= 100 else P["ember"] if pct >= 60 else P["rose"]
            self.status_word_goal.config(text=f"goal: {bar} {pct}%", fg=color)
        else:
            self.status_word_goal.config(text="")

    def _update_minimap(self):
        mc = self.minimap_canvas
        mc.delete("all")
        mw = mc.winfo_width()
        mh = mc.winfo_height()
        if mw < 5 or mh < 5:
            return
        content = self.editor.get("1.0", "end-1c")
        lines = content.split("\n")
        total = len(lines)
        if total == 0:
            return
        scale = min(mh / max(total, 1), 3.0)
        for i, line in enumerate(lines):
            y = int(i * scale)
            line_len = min(len(line), 60)
            bar_w = max(1, int(line_len / 60 * (mw - 6)))
            color = P["text_dim"]
            if line.startswith("# "):
                color = P["heading"]
            elif line.startswith("## ") or line.startswith("### "):
                color = P["amethyst"]
            elif "[[" in line:
                color = P["link"]
            elif line.startswith("> "):
                color = P["cyan_dim"]
            mc.create_rectangle(3, y, 3 + bar_w, y + max(1, int(scale)),
                                fill=color, outline="")
        # Viewport indicator
        try:
            top = float(self.editor.index("@0,0").split(".")[0])
            bot = float(self.editor.index(f"@0,{self.editor.winfo_height()}").split(".")[0])
            vy1 = int(top * scale)
            vy2 = int(bot * scale)
            mc.create_rectangle(0, vy1, mw, vy2,
                                fill="", outline=P["cyan_dim"], width=1)
        except Exception:
            pass

    def _on_minimap_click(self, event):
        mc = self.minimap_canvas
        mh = mc.winfo_height()
        content = self.editor.get("1.0", "end-1c")
        total = len(content.split("\n"))
        if total == 0 or mh == 0:
            return
        frac = event.y / mh
        target_line = max(1, int(frac * total))
        self.editor.see(f"{target_line}.0")
        self.editor.mark_set("insert", f"{target_line}.0")

    def _on_editor_scroll(self, *args):
        self.editor.yview(*args)
        self.line_numbers.yview(*args)

    def _on_editor_yscroll(self, first, last):
        """Called when editor content scrolls — sync scrollbar + line numbers."""
        self._editor_scrollbar.set(first, last)
        self.line_numbers.yview("moveto", first)

    # ─── WIKI-LINK NAVIGATION ────────────────────────────────────
    def _on_ctrl_click(self, event):
        idx = self.editor.index(f"@{event.x},{event.y}")
        if "link" not in self.editor.tag_names(idx):
            return
        li = int(idx.split(".")[0])
        line = self.editor.get(f"{li}.0", f"{li}.end")
        col = int(idx.split(".")[1])
        for m in re.finditer(r'\[\[([^\]]+)\]\]', line):
            if m.start() <= col <= m.end():
                self._navigate_to(m.group(1))
                return

    def _navigate_to(self, name):
        if not _is_safe_note_name(name):
            return
        target = self.vault_path / f"{name}.md"
        if target.exists():
            self._maybe_save_then(lambda: self._open_file(target))
        elif messagebox.askyesno("Create?", f"'{name}' doesn't exist. Create?"):
            try:
                target.write_text(f"# {name}\n\n", encoding="utf-8")
            except OSError as e:
                messagebox.showerror("Error", f"Cannot create note:\n{e}")
                return
            self._refresh_file_tree()
            self._rebuild_graph_data()
            self._open_file(target)

    # ─── BACKLINKS + OUTLINE ─────────────────────────────────────
    def _update_backlinks(self):
        self.backlinks_listbox.delete(0, "end")
        if not self.current_file:
            return
        cn = self.current_file.stem
        cn_escaped = re.escape(cn)
        bl_pattern = re.compile(rf'\[\[{cn_escaped}(\]\]|[|#])')
        for fp in self._all_files:
            if fp == self.current_file:
                continue
            if bl_pattern.search(self._read_cached(fp)):
                self.backlinks_listbox.insert("end", f"  <- {fp.stem}")

    def _on_backlink_select(self, event):
        sel = self.backlinks_listbox.curselection()
        if not sel:
            return
        name = self.backlinks_listbox.get(sel[0]).strip().lstrip("<- ").strip()
        for fp in self._all_files:
            if fp.stem == name:
                self._maybe_save_then(lambda: self._open_file(fp))
                return

    def _update_outline(self):
        self.outline_listbox.delete(0, "end")
        self._outline_lines = []
        content = self.editor.get("1.0", "end")
        for i, line in enumerate(content.split("\n"), start=1):
            if line.startswith("### "):
                self.outline_listbox.insert("end", f"      {line[4:]}")
                self._outline_lines.append(i)
            elif line.startswith("## "):
                self.outline_listbox.insert("end", f"   {line[3:]}")
                self._outline_lines.append(i)
            elif line.startswith("# "):
                self.outline_listbox.insert("end", f" {line[2:]}")
                self._outline_lines.append(i)

    def _on_outline_select(self, event):
        sel = self.outline_listbox.curselection()
        if not sel:
            return
        idx = sel[0]
        if idx >= len(self._outline_lines):
            return
        line_no = self._outline_lines[idx]
        self.editor.see(f"{line_no}.0")
        self.editor.mark_set("insert", f"{line_no}.0")

    # ─── SEARCH ──────────────────────────────────────────────────
    def _toggle_search(self):
        self.search_visible = not self.search_visible
        if self.search_visible:
            self.search_bar.pack(fill="x", after=self.tab_bar)
            self.replace_bar.pack(fill="x", after=self.search_bar)
            self.search_entry.focus_set()
        else:
            self.search_bar.pack_forget()
            self.replace_bar.pack_forget()
            self.editor.tag_remove("search_match", "1.0", "end")
            self._search_match_positions = []

    def _do_search(self):
        self.editor.tag_remove("search_match", "1.0", "end")
        q = self.search_entry_var.get()
        if not q:
            self._search_match_positions = []
            return
        use_regex = self._search_regex_var.get()
        start, count = "1.0", 0
        positions: list[str] = []
        while True:
            pos = self.editor.search(q, start, stopindex="end", nocase=True,
                                      regexp=use_regex)
            if not pos:
                break
            if use_regex:
                # For regex, measure actual match length
                line_idx = pos.split(".")[0]
                col = int(pos.split(".")[1])
                line_text = self.editor.get(f"{line_idx}.0", f"{line_idx}.end")
                m = re.search(q, line_text[col:], re.IGNORECASE)
                match_len = len(m.group()) if m else len(q)
            else:
                match_len = len(q)
            end = f"{pos}+{match_len}c"
            self.editor.tag_add("search_match", pos, end)
            positions.append(pos)
            start = end
            count += 1
            if count == 1:
                self.editor.see(pos)
        self._search_match_positions = positions
        self._search_match_idx = 0
        self.status_left.config(text=f"found {count} match{'es' if count != 1 else ''}")

    def _search_next(self):
        """Jump to next search match."""
        if not self._search_match_positions:
            self._do_search()
            return
        self._search_match_idx = (self._search_match_idx + 1) % len(self._search_match_positions)
        pos = self._search_match_positions[self._search_match_idx]
        self.editor.see(pos)
        self.editor.mark_set("insert", pos)
        n = len(self._search_match_positions)
        self.status_left.config(text=f"match {self._search_match_idx + 1}/{n}")

    def _search_prev(self):
        """Jump to previous search match."""
        if not self._search_match_positions:
            self._do_search()
            return
        self._search_match_idx = (self._search_match_idx - 1) % len(self._search_match_positions)
        pos = self._search_match_positions[self._search_match_idx]
        self.editor.see(pos)
        self.editor.mark_set("insert", pos)
        n = len(self._search_match_positions)
        self.status_left.config(text=f"match {self._search_match_idx + 1}/{n}")

    def _replace_one(self):
        """Replace current match and advance."""
        if not self._search_match_positions:
            self._do_search()
            return
        q = self.search_entry_var.get()
        r = self.replace_entry_var.get()
        idx = self._search_match_idx
        pos = self._search_match_positions[idx]
        use_regex = self._search_regex_var.get()
        if use_regex:
            line_idx = pos.split(".")[0]
            col = int(pos.split(".")[1])
            line_text = self.editor.get(f"{line_idx}.0", f"{line_idx}.end")
            m = re.search(q, line_text[col:], re.IGNORECASE)
            match_len = len(m.group()) if m else len(q)
        else:
            match_len = len(q)
        end = f"{pos}+{match_len}c"
        self.editor.delete(pos, end)
        self.editor.insert(pos, r)
        self._do_search()

    def _replace_all(self):
        """Replace all matches."""
        q = self.search_entry_var.get()
        r = self.replace_entry_var.get()
        if not q:
            return
        content = self.editor.get("1.0", "end-1c")
        use_regex = self._search_regex_var.get()
        if use_regex:
            new_content, count = re.subn(q, r, content, flags=re.IGNORECASE)
        else:
            count = content.lower().count(q.lower())
            # Case-insensitive replace without regex
            result, i = [], 0
            ql = q.lower()
            cl = content.lower()
            while i < len(content):
                if cl[i:i + len(q)] == ql:
                    result.append(r)
                    i += len(q)
                else:
                    result.append(content[i])
                    i += 1
            new_content = "".join(result)
        self.editor.delete("1.0", "end")
        self.editor.insert("1.0", new_content)
        self._search_match_positions = []
        self.editor.tag_remove("search_match", "1.0", "end")
        self.status_left.config(text=f"replaced {count} occurrence{'s' if count != 1 else ''}")
        self._show_toast(f"Replaced {count}")
        self._apply_syntax()

    # ─── VIEW SWITCHING ──────────────────────────────────────────
    def _show_editor(self):
        self._hide_all_views()
        if self._split_active:
            self.editor_container.pack(fill="both", expand=True, padx=4, pady=(4, 1), side="top")
            self.split_container.pack(fill="both", expand=True, padx=4, pady=(1, 4), side="top")
        else:
            self.editor_container.pack(fill="both", expand=True, padx=4, pady=4)
        self.view_mode = "editor"
        self.view_indicator.config(text="EDITOR", fg=P["cyan_dim"])
        self.status_left.config(text="editor view")
        self._update_word_count()

    def _show_preview(self):
        self._hide_all_views()
        self.preview_frame.pack(fill="both", expand=True, padx=4, pady=4)
        self.view_mode = "preview"
        self.view_indicator.config(text="PREVIEW", fg=P["ice"])
        self.status_left.config(text="markdown preview (read-only)")
        self._render_preview()

    def _render_preview(self):
        pt = self.preview_text
        pt.config(state="normal")
        pt.delete("1.0", "end")
        content = self.editor.get("1.0", "end-1c")
        for line in content.split("\n"):
            if line.startswith("### "):
                pt.insert("end", line[4:] + "\n", "h3")
            elif line.startswith("## "):
                pt.insert("end", line[3:] + "\n", "h2")
            elif line.startswith("# "):
                pt.insert("end", line[2:] + "\n", "h1")
            elif line.startswith("> "):
                pt.insert("end", "  " + line[2:] + "\n", "p_quote")
            elif re.match(r'^-{3,}$', line.strip()):
                pt.insert("end", "  " + "\u2500" * 40 + "\n", "p_hr")
            elif re.match(r'^\s*- \[x\]\s', line):
                text = re.sub(r'^\s*- \[x\]\s*', '', line)
                pt.insert("end", "  \u2611 " + text + "\n", "p_bold")
            elif re.match(r'^\s*- \[ \]\s', line):
                text = re.sub(r'^\s*- \[ \]\s*', '', line)
                pt.insert("end", "  \u2610 " + text + "\n", "p_bullet")
            elif re.match(r'^\s*[-*]\s', line):
                bullet_text = re.sub(r'^\s*[-*]\s', '', line)
                pt.insert("end", "  \u25B8 " + bullet_text + "\n", "p_bullet")
            else:
                # Process inline formatting
                self._insert_preview_line(pt, line)
        pt.config(state="disabled")

    def _insert_preview_line(self, pt, line):
        parts = _RE_PREVIEW_SPLIT.split(line)
        for part in parts:
            if re.match(r'^\*\*(.+)\*\*$', part):
                pt.insert("end", part[2:-2], "p_bold")
            elif re.match(r'^`(.+)`$', part):
                pt.insert("end", part[1:-1], "p_code")
            elif re.match(r'^\[\[(.+)\]\]$', part):
                pt.insert("end", part[2:-2], "p_link")
            elif re.match(r'^#\w', part):
                pt.insert("end", part, "p_tag")
            else:
                pt.insert("end", part)
        pt.insert("end", "\n")

    def _show_graph(self):
        self._hide_all_views()
        self.graph_frame.pack(fill="both", expand=True, padx=4, pady=4)
        self.view_mode = "graph"
        self.view_indicator.config(text="GRAPH", fg=P["amethyst"])
        self.status_left.config(text="graph view — click node to open")
        self.root.after(50, self._draw_graph)

    def _show_schema(self):
        self._hide_all_views()
        self.schema_frame.pack(fill="both", expand=True, padx=4, pady=4)
        self.view_mode = "schema"
        self.view_indicator.config(text="PIPELINE", fg=P["emerald"])
        self.status_left.config(text="Shumilek AI pipeline — pick a scenario")
        self.root.after(50, self._draw_schema)

    # ─── GRAPH VIEW ──────────────────────────────────────────────
    def _rebuild_graph_data(self):
        self.notes_graph.clear()
        try:
            md_files = list(self.vault_path.glob("**/*.md"))
        except OSError:
            md_files = []
        for fp in md_files:
            try:
                name = fp.stem
                content = self._read_cached(fp)
                for link in re.findall(r'\[\[([^\]|#]+)', content):
                    link = link.strip()
                    if link and link != name:
                        self.notes_graph[name].add(link)
                        self.notes_graph[link]  # ensure exists
            except Exception:
                continue  # skip malformed files

    def _draw_graph(self):
        c = self.graph_canvas
        c.delete("all")
        nodes = list(self.notes_graph.keys())
        if not nodes:
            c.create_text(200, 150, text="no linked notes yet", font=F_TITLE, fill=P["text_dim"])
            return
        w = max(c.winfo_width(), 400)
        h = max(c.winfo_height(), 300)
        cx, cy = w // 2, h // 2
        t = time.time()

        # ── Starfield background ──
        self._graph_starfield.draw(c, w, h, t)

        # ── Nebula clouds ──
        if not hasattr(self, '_graph_nebulae'):
            self._graph_nebulae = []
            neb_colors = [P["cyan_dim"], P["amethyst_dim"], P["rose_dim"]]
            for _ in range(4):
                self._graph_nebulae.append({
                    "x": random.uniform(0.15, 0.85),
                    "y": random.uniform(0.15, 0.85),
                    "r": random.uniform(50, 100),
                    "color": random.choice(neb_colors),
                    "phase": random.uniform(0, math.pi * 2),
                })
        _draw_nebulae(c, w, h, self._graph_nebulae, rings=3, opacity=0.03, t=t)

        # ── Breathing hex grid overlay ──
        grid_pulse = 0.4 + 0.6 * abs(math.sin(t * 0.5))
        grid_color = _hex_color_scale(P["border"], grid_pulse)
        for gx in range(0, w, 40):
            for gy in range(0, h, 40):
                offset = 20 if (gy // 40) % 2 else 0
                c.create_text(gx + offset, gy, text="\u00b7", font=(FONT, 5),
                             fill=grid_color, anchor="center")

        # Heat map importance
        importance = self._compute_note_importance()

        # Layout
        n = len(nodes)
        positions = {}
        layout = self._graph_layout_mode

        if layout == "force":
            # Force-directed: repulsion between all nodes, attraction on edges
            # Initialize positions in circle, then iterate
            radius = min(w, h) * 0.35
            for i, node in enumerate(nodes):
                a = 2 * math.pi * i / n - math.pi / 2
                positions[node] = [cx + radius * math.cos(a), cy + radius * math.sin(a)]
            # Simple iterative force computation (30 iterations for perf)
            for _ in range(30):
                forces: dict[str, list[float]] = {nd: [0.0, 0.0] for nd in nodes}
                # Repulsion (Coulomb)
                for i_n in range(n):
                    for j_n in range(i_n + 1, n):
                        na, nb = nodes[i_n], nodes[j_n]
                        dx = positions[na][0] - positions[nb][0]
                        dy = positions[na][1] - positions[nb][1]
                        d = max(math.hypot(dx, dy), 1.0)
                        rep = 8000.0 / (d * d)
                        fx, fy = rep * dx / d, rep * dy / d
                        forces[na][0] += fx
                        forces[na][1] += fy
                        forces[nb][0] -= fx
                        forces[nb][1] -= fy
                    # Attraction (Hooke) for edges
                for src_node, tgts in self.notes_graph.items():
                    if src_node not in positions:
                        continue
                    for tgt in tgts:
                        if tgt not in positions:
                            continue
                        dx = positions[tgt][0] - positions[src_node][0]
                        dy = positions[tgt][1] - positions[src_node][1]
                        d = max(math.hypot(dx, dy), 1.0)
                        attr = d * 0.01
                        fx, fy = attr * dx / d, attr * dy / d
                        forces[src_node][0] += fx
                        forces[src_node][1] += fy
                        forces[tgt][0] -= fx
                        forces[tgt][1] -= fy
                # Apply forces with damping
                for nd in nodes:
                    positions[nd][0] = max(30, min(w - 30, positions[nd][0] + forces[nd][0] * 0.1))
                    positions[nd][1] = max(30, min(h - 30, positions[nd][1] + forces[nd][1] * 0.1))
            # Convert to tuple
            positions = {nd: (p[0], p[1]) for nd, p in positions.items()}

        elif layout == "radial":
            # Radial: most-connected node at center, layers by distance
            conn_tmp: dict[str, int] = {}
            for nd in nodes:
                out_c = len(self.notes_graph.get(nd, set()))
                in_c = sum(1 for tgts in self.notes_graph.values() if nd in tgts)
                conn_tmp[nd] = out_c + in_c
            sorted_nodes = sorted(nodes, key=lambda x: conn_tmp.get(x, 0), reverse=True)
            if sorted_nodes:
                positions[sorted_nodes[0]] = (cx, cy)
            ring_spacing = min(w, h) * 0.15
            ring_idx = 1
            ring_capacity = 6
            placed = 1
            while placed < n:
                ring_r = ring_spacing * ring_idx
                count_in_ring = min(ring_capacity, n - placed)
                for j in range(count_in_ring):
                    a = 2 * math.pi * j / count_in_ring - math.pi / 2
                    nd = sorted_nodes[placed]
                    positions[nd] = (cx + ring_r * math.cos(a), cy + ring_r * math.sin(a))
                    placed += 1
                ring_idx += 1
                ring_capacity = int(ring_capacity * 1.5)

        else:
            # Circular (default)
            radius = min(w, h) * 0.33
            for i, node in enumerate(nodes):
                a = 2 * math.pi * i / n - math.pi / 2
                positions[node] = (cx + radius * math.cos(a), cy + radius * math.sin(a))

        # Apply custom position overrides
        for node in nodes:
            if node in self._graph_custom_positions:
                positions[node] = self._graph_custom_positions[node]

        # ── Pre-compute connection counts ──
        incoming: dict[str, int] = {}
        for tgts in self.notes_graph.values():
            for tgt in tgts:
                incoming[tgt] = incoming.get(tgt, 0) + 1
        conn_count: dict[str, int] = {}
        for node in nodes:
            out_c = len(self.notes_graph.get(node, set()))
            conn_count[node] = out_c + incoming.get(node, 0)

        # ── Edges: curved lines with directional arrows ──
        drawn_edges: set[tuple[str, str]] = set()
        for src, tgts in self.notes_graph.items():
            if src not in positions:
                continue
            sx, sy = positions[src]
            for tgt in tgts:
                if tgt not in positions:
                    continue
                edge_key = (min(src, tgt), max(src, tgt))
                if edge_key in drawn_edges:
                    continue
                drawn_edges.add(edge_key)
                tx, ty = positions[tgt]

                edge_imp = max(importance.get(src, 0), importance.get(tgt, 0))
                # Edge width by importance
                ew = 1 if edge_imp < 0.3 else 2 if edge_imp < 0.6 else 3

                # Edge color by importance
                if edge_imp >= 0.7:
                    ec = P["cyan_dim"]
                elif edge_imp >= 0.4:
                    ec = P["amethyst_dim"]
                else:
                    ec = P["border_glow"]

                # Curved bezier: offset midpoint perpendicular to edge
                mx_raw = (sx + tx) / 2
                my_raw = (sy + ty) / 2
                dx, dy = tx - sx, ty - sy
                dist = math.hypot(dx, dy)
                if dist > 0:
                    # Perpendicular offset for curve
                    perp_x = -dy / dist
                    perp_y = dx / dist
                    curve_offset = min(30, dist * 0.12)
                    mx = mx_raw + perp_x * curve_offset
                    my = my_raw + perp_y * curve_offset
                else:
                    mx, my = mx_raw, my_raw

                # Neon glow behind edge
                glow_ec = _hex_color_scale(ec, 0.3)
                c.create_line(sx, sy, mx, my, tx, ty,
                             fill=glow_ec, width=ew + 4, smooth=True)
                c.create_line(sx, sy, mx, my, tx, ty,
                             fill=ec, width=ew, smooth=True)

                # Directional arrow at midpoint
                if dist > 60:
                    # Arrow pointing src→tgt at midpoint
                    arr_x = mx
                    arr_y = my
                    angle = math.atan2(ty - sy, tx - sx)
                    asize = 5 + ew
                    ax1 = arr_x - asize * math.cos(angle - 0.4)
                    ay1 = arr_y - asize * math.sin(angle - 0.4)
                    ax2 = arr_x - asize * math.cos(angle + 0.4)
                    ay2 = arr_y - asize * math.sin(angle + 0.4)
                    c.create_polygon(arr_x, arr_y, ax1, ay1, ax2, ay2,
                                    fill=ec, outline="")

        # ── Animated flow particles along edges ──
        c.delete("graph_flow")
        for fp in self._graph_flow_particles:
            fp.draw_on(c, "graph_flow")

        # ── Nodes ──
        self._graph_node_positions = {}
        active = self.current_file.stem if self.current_file else None

        # Separate orphans (nodes with 0 connections)
        orphans = [node for node in nodes if conn_count.get(node, 0) == 0]

        for node, (x, y) in positions.items():
            conn = conn_count.get(node, 0)
            r = max(8, min(20, 6 + conn * 2))
            is_active = node == active
            is_orphan = node in orphans
            imp = importance.get(node, 0.0)

            if is_active:
                fill = P["cyan"]
                glow = P["cyan_dim"]
                border_c = P["cyan"]
            elif is_orphan:
                fill = P["surface"]
                glow = P["border"]
                border_c = P["border_glow"]
            else:
                if imp >= 0.7:
                    fill = P["emerald"]
                    glow = P["cyan_dim"]
                    border_c = P["emerald"]
                elif imp >= 0.4:
                    fill = P["ice"]
                    glow = P["amethyst_dim"]
                    border_c = P["ice"]
                else:
                    fill = P["amethyst_dim"]
                    glow = P["border_glow"]
                    border_c = P["amethyst_dim"]

            # Active node pulse animation
            if is_active:
                pulse = abs(math.sin(t * 3))
                pulse_r = r + 6 + int(pulse * 8)
                c.create_oval(x - pulse_r, y - pulse_r, x + pulse_r, y + pulse_r,
                             fill="", outline=P["cyan_dim"], width=1, dash=(2, 4))
                pulse_r2 = r + 3 + int(pulse * 4)
                c.create_oval(x - pulse_r2, y - pulse_r2, x + pulse_r2, y + pulse_r2,
                             fill="", outline=P["cyan"], width=2)

            # Importance glow ring (for high-importance non-active nodes)
            elif imp > 0.5:
                glow_r = r + 4 + int(imp * 6)
                c.create_oval(x - glow_r, y - glow_r, x + glow_r, y + glow_r,
                             fill="", outline=glow, width=2, dash=(3, 3))

            # Soft multi-ring glow halo
            for ri in range(4):
                frac = 1.0 - ri / 4.0
                gr = r + 5 + ri * 4
                c.create_oval(x - gr, y - gr, x + gr, y + gr,
                             fill=_hex_color_scale(glow, 0.15 * frac), outline="")

            # Orphan dashed ring
            if is_orphan and not is_active:
                c.create_oval(x - r - 5, y - r - 5, x + r + 5, y + r + 5,
                             fill="", outline=P["border_glow"], width=1, dash=(2, 6))

            # Outer ring
            c.create_oval(x - r - 3, y - r - 3, x + r + 3, y + r + 3,
                         fill="", outline=glow, width=2)

            # Main node circle
            c.create_oval(x - r, y - r, x + r, y + r,
                         fill=fill, outline=border_c, width=2)

            # Inner highlight (pixel-art style)
            if r >= 10:
                ir = r - 3
                c.create_oval(x - ir, y - ir, x + ir, y + ir,
                             fill="", outline=P["surface"], width=1)

            # Connection count badge (top-right)
            if conn > 0 and r >= 8:
                badge_x = x + r - 2
                badge_y = y - r + 2
                badge_r = 6
                c.create_oval(badge_x - badge_r, badge_y - badge_r,
                             badge_x + badge_r, badge_y + badge_r,
                             fill=P["surface"], outline=border_c, width=1)
                c.create_text(badge_x, badge_y, text=str(conn),
                             font=(FONT, 6), fill=P["text_bright"])

            # Label with background box
            label_y = y + r + 12
            lbl_text = node
            # Measure approximate label width
            lbl_w = len(lbl_text) * 6 + 12
            lbl_h = 12
            if is_active:
                c.create_rectangle(x - lbl_w // 2, label_y - lbl_h // 2,
                                  x + lbl_w // 2, label_y + lbl_h // 2,
                                  fill=P["surface"], outline=P["cyan_dim"], width=1)
            c.create_text(x, label_y, text=lbl_text, font=F_SMALL,
                         fill=P["text_bright"] if is_active else
                               (P["text_dim"] if is_orphan else P["text"]))

            self._graph_node_positions[node] = (x, y, r)

        # ── AI Real-time Activity Overlay ──
        if self.pipeline.is_running or self._graph_ai_active_nodes:
            t2 = time.time()

            # Scan waves (expanding circles from processed nodes)
            for wave in self._graph_ai_scan_waves:
                wr = wave["r"]
                if wr > 0:
                    alpha_frac = max(0, 1.0 - wr / wave["max_r"])
                    # Approximate alpha by using dashes
                    dash_gap = max(1, int(8 * (1 - alpha_frac)))
                    c.create_oval(wave["x"] - wr, wave["y"] - wr,
                                 wave["x"] + wr, wave["y"] + wr,
                                 fill="", outline=wave["color"], width=1,
                                 dash=(2, dash_gap))

            # AI-active node highlights (pulsing glow overlay)
            for node_stem, info in self._graph_ai_active_nodes.items():
                if node_stem not in self._graph_node_positions:
                    continue
                nx, ny, nr = self._graph_node_positions[node_stem]
                intensity = info["intensity"]
                stage = info["stage"]

                # Stage-colored pulsing ring
                pulse = abs(math.sin(t2 * 4 + hash(node_stem) % 10))
                ring_r = nr + 4 + int(pulse * 6 * intensity)
                stage_color_key = "border_glow"
                for nid, _, ck, _ in PipelineSimulator.NODES:
                    if nid == stage:
                        stage_color_key = ck
                        break
                sc = P.get(stage_color_key, P["cyan"])

                c.create_oval(nx - ring_r, ny - ring_r,
                             nx + ring_r, ny + ring_r,
                             fill="", outline=sc, width=2)

                # Inner scan line effect (horizontal line sweeping through node)
                scan_y_off = int(math.sin(t2 * 5 + hash(node_stem)) * nr * 0.7)
                c.create_line(nx - nr, ny + scan_y_off,
                             nx + nr, ny + scan_y_off,
                             fill=sc, width=1)

                # Small stage label above active nodes
                if intensity > 0.5:
                    stage_short = {
                        "context": "SCAN", "routing": "ROUTE",
                        "rozum": "PLAN", "generate": "GEN",
                        "guardian": "CHK", "halluc": "HLUC",
                        "svedomi": "VAL", "decision": "DEC",
                        "output": "OUT",
                    }.get(stage, "?")
                    c.create_text(nx, ny - nr - 10,
                                 text=stage_short, font=(FONT, 6),
                                 fill=sc)

            # Data transfer trails (moving dots between connected nodes)
            for trail in self._graph_ai_trails:
                p = trail["progress"]
                tx = trail["x1"] + (trail["x2"] - trail["x1"]) * p
                ty = trail["y1"] + (trail["y2"] - trail["y1"]) * p
                c.create_oval(tx - 3, ty - 3, tx + 3, ty + 3,
                             fill=trail["color"], outline=P["text_bright"])
                # Fading tail
                for tail_i in range(3):
                    tp = max(0, p - (tail_i + 1) * 0.06)
                    ttx = trail["x1"] + (trail["x2"] - trail["x1"]) * tp
                    tty = trail["y1"] + (trail["y2"] - trail["y1"]) * tp
                    tail_s = max(1, 2 - tail_i)
                    c.create_oval(ttx - tail_s, tty - tail_s,
                                 ttx + tail_s, tty + tail_s,
                                 fill=trail["color"], outline="")

        # ── Title ──
        total_links = sum(len(v) for v in self.notes_graph.values())
        c.create_rectangle(6, 4, 260, 48, fill=P["surface"], outline=P["border"], width=1)
        c.create_text(12, 12, text="\u25C8 Knowledge Graph", font=F_HEAD,
                     fill=P["heading"], anchor="nw")
        c.create_text(12, 32, text=f"{n} notes \u2022 {total_links} links \u2022 {len(orphans)} orphans",
                     font=F_PIXEL, fill=P["text_dim"], anchor="nw")

        # ── AI Live Status Panel (top-right) ──
        if self.pipeline.is_running or self._graph_ai_stage:
            ai_pw, ai_ph = 240, 90
            ai_px = w - ai_pw - 10
            ai_py = 6
            is_live = self.pipeline.is_running
            border_col = self._graph_ai_stage_color if is_live else P["ok"]
            c.create_rectangle(ai_px, ai_py, ai_px + ai_pw, ai_py + ai_ph,
                              fill=P["panel"], outline=border_col, width=2)
            # Corner accents
            for (cx_, cy_) in [(ai_px, ai_py), (ai_px + ai_pw - 4, ai_py),
                               (ai_px, ai_py + ai_ph - 4), (ai_px + ai_pw - 4, ai_py + ai_ph - 4)]:
                c.create_rectangle(cx_, cy_, cx_ + 4, cy_ + 4,
                                  fill=border_col, outline="")
            # Live indicator
            if is_live:
                pulse_dot = abs(math.sin(time.time() * 4))
                dot_r = 3 + int(pulse_dot * 2)
                dot_x = ai_px + 14
                dot_y = ai_py + 13
                c.create_oval(dot_x - dot_r, dot_y - dot_r,
                             dot_x + dot_r, dot_y + dot_r,
                             fill=P["emerald"], outline="")
                c.create_text(ai_px + 26, ai_py + 10,
                             text="AI LIVE", font=F_SMALL,
                             fill=P["emerald"], anchor="nw")
            else:
                c.create_text(ai_px + 10, ai_py + 10,
                             text="\u2713 COMPLETE", font=F_SMALL,
                             fill=P["ok"], anchor="nw")

            # Current stage
            c.create_text(ai_px + 10, ai_py + 28,
                         text=f"Stage: {self._graph_ai_stage}",
                         font=F_SMALL, fill=self._graph_ai_stage_color, anchor="nw")

            # Pipeline progress bar
            done_count = sum(1 for s in self.pipeline.node_states.values() if s == "done")
            total_stages = len(PipelineSimulator.NODES)
            progress = done_count / total_stages if total_stages > 0 else 0
            bar_x = ai_px + 10
            bar_y = ai_py + 46
            bar_w = ai_pw - 20
            c.create_rectangle(bar_x, bar_y, bar_x + bar_w, bar_y + 8,
                              fill=P["panel_alt"], outline=P["border"])
            # Segmented fill — one segment per pipeline stage
            seg_w = bar_w / total_stages
            for si, (nid, _, ck, _) in enumerate(PipelineSimulator.NODES):
                sx = bar_x + si * seg_w
                state = self.pipeline.node_states.get(nid, "idle")
                if state == "done":
                    c.create_rectangle(sx, bar_y, sx + seg_w, bar_y + 8,
                                      fill=P["ok"], outline="")
                elif state == "active":
                    # Animated fill for active segment
                    fill_frac = abs(math.sin(time.time() * 3))
                    c.create_rectangle(sx, bar_y, sx + seg_w * fill_frac, bar_y + 8,
                                      fill=P.get(ck, P["cyan"]), outline="")
                elif state in ("error", "retry"):
                    c.create_rectangle(sx, bar_y, sx + seg_w, bar_y + 8,
                                      fill=P["err"] if state == "error" else P["warn"], outline="")
            # Progress text
            c.create_text(bar_x + bar_w + 2, bar_y + 4,
                         text=f"{done_count}/{total_stages}", font=(FONT, 6),
                         fill=P["text_dim"], anchor="w")

            # Active nodes count
            active_n = len(self._graph_ai_active_nodes)
            c.create_text(ai_px + ai_pw - 10, ai_py + 10,
                         text=f"{active_n} nodes", font=F_PIXEL,
                         fill=P["text_dim"], anchor="ne")

            # Active Hive task kind
            if self._ai_processing_task:
                task_kind = self._ai_processing_task.get("kind", "task").upper()
                task_prog = self._ai_processing_task.get("progress", 0)
                c.create_text(ai_px + 10, ai_py + 62,
                             text=f"\u25B6 {task_kind} [{task_prog}%]",
                             font=F_PIXEL, fill=P["cyan"], anchor="nw")
                task_txt = self._ai_processing_task.get("text", "")[:28]
                c.create_text(ai_px + 10, ai_py + 76,
                             text=task_txt, font=F_PIXEL,
                             fill=P["text_dim"], anchor="nw")

        # ── Vignette overlay — dark edges for cinematic depth ──
        _draw_vignette(c, w, h, size=30)

        # ── Graph stats panel (bottom-right) ──
        self._draw_graph_stats(c, w, h, nodes, importance, conn_count, orphans)

        # ── Heat map legend (bottom-left) ──
        ly = h - 28
        c.create_rectangle(6, ly - 6, 200, ly + 14, fill=P["surface"], outline=P["border"], width=1)
        c.create_text(12, ly, text="\u25CF low", font=F_PIXEL,
                     fill=P["amethyst_dim"], anchor="w")
        c.create_text(60, ly, text="\u25CF mid", font=F_PIXEL,
                     fill=P["ice"], anchor="w")
        c.create_text(100, ly, text="\u25CF high", font=F_PIXEL,
                     fill=P["emerald"], anchor="w")
        c.create_text(145, ly, text="\u25CB orphan", font=F_PIXEL,
                     fill=P["border_glow"], anchor="w")

    def _draw_graph_stats(self, c, w, h, nodes, importance, conn_count, orphans):
        """Draw graph statistics panel in bottom-right corner."""
        pw, ph = 200, 80
        mx = w - pw - 10
        my = h - ph - 10
        c.create_rectangle(mx, my, mx + pw, my + ph,
                          fill=P["surface"], outline=P["border"], width=1)
        # Corner accents
        for (cx_, cy_) in [(mx, my), (mx + pw, my), (mx, my + ph), (mx + pw, my + ph)]:
            c.create_rectangle(cx_ - 2, cy_ - 2, cx_ + 2, cy_ + 2,
                              fill=P["border_glow"], outline="")

        c.create_text(mx + 8, my + 8, text="\u25C8 Stats", font=F_SMALL,
                     fill=P["heading"], anchor="nw")

        # Density
        n = len(nodes)
        max_edges = n * (n - 1) / 2 if n > 1 else 1
        actual_edges = sum(len(v) for v in self.notes_graph.values())
        density = actual_edges / max_edges if max_edges > 0 else 0

        # Most connected
        most = max(conn_count, key=conn_count.get) if conn_count else "—"
        most_n = conn_count.get(most, 0)

        # Avg importance
        imps = [importance.get(nd, 0) for nd in nodes]
        avg_imp = sum(imps) / len(imps) if imps else 0

        c.create_text(mx + 8, my + 26, text=f"Density: {density:.0%}",
                     font=F_PIXEL, fill=P["text"], anchor="nw")
        c.create_text(mx + 8, my + 40, text=f"Hub: {most} ({most_n})",
                     font=F_PIXEL, fill=P["cyan_dim"], anchor="nw")
        c.create_text(mx + 8, my + 54, text=f"Avg imp: {avg_imp:.0%}",
                     font=F_PIXEL, fill=P["text_dim"], anchor="nw")

        # Mini density bar
        bar_x = mx + 8
        bar_y = my + 68
        bar_w = pw - 16
        c.create_rectangle(bar_x, bar_y, bar_x + bar_w, bar_y + 6,
                          fill=P["panel"], outline=P["border"])
        fill_w = int(bar_w * min(1, density))
        if fill_w > 0:
            c.create_rectangle(bar_x, bar_y, bar_x + fill_w, bar_y + 6,
                              fill=P["emerald"], outline="")

    def _graph_ai_tick(self):
        """Update graph AI activity state based on current pipeline stage."""
        t = time.time()
        nodes = list(self._graph_node_positions.keys())
        if not nodes:
            return

        # Determine active pipeline stage
        active_stage = ""
        active_color_key = "border_glow"
        for nid, lbl, ck, desc in PipelineSimulator.NODES:
            if self.pipeline.node_states.get(nid) == "active":
                active_stage = nid
                active_color_key = ck
                break

        if not active_stage:
            return

        # Map pipeline stages to graph node behavior
        stage_label = {
            "context": "CONTEXT SCAN",
            "routing": "INPUT ROUTING",
            "rozum": "AI PLANNING",
            "generate": "GENERATING",
            "guardian": "QUALITY CHECK",
            "halluc": "HALLUC DETECT",
            "svedomi": "VALIDATING",
            "decision": "DECIDING",
            "output": "DELIVERING",
        }
        self._graph_ai_stage = stage_label.get(active_stage, active_stage.upper())
        self._graph_ai_stage_color = P.get(active_color_key, P["text"])

        # How many graph nodes should be "active" based on stage
        if active_stage == "context":
            # Context gathering: light up many nodes sequentially (scanning)
            frac = 0.5 + 0.3 * abs(math.sin(t * 2))
            count = max(2, int(len(nodes) * frac))
        elif active_stage in ("generate", "rozum"):
            # Generation/planning: focus on a few connected nodes
            count = max(1, len(nodes) // 4)
        elif active_stage in ("guardian", "halluc", "svedomi"):
            # Validation: check pairs of nodes
            count = max(1, len(nodes) // 3)
        else:
            count = max(1, len(nodes) // 5)

        # Select which nodes to activate (deterministic-ish, shifting over time)
        phase = int(t * 1.5) % max(1, len(nodes))
        selected = set()
        for i in range(count):
            idx = (phase + i * 3) % len(nodes)
            selected.add(nodes[idx])

        # Update active nodes
        color = P.get(active_color_key, P["cyan"])
        for node in nodes:
            if node in selected:
                if node not in self._graph_ai_active_nodes:
                    self._graph_ai_active_nodes[node] = {
                        "stage": active_stage, "t_start": t, "intensity": 0.0
                    }
                    # Emit scan wave from this node
                    if node in self._graph_node_positions:
                        nx, ny, nr = self._graph_node_positions[node]
                        self._graph_ai_scan_waves.append({
                            "x": nx, "y": ny, "r": 0, "max_r": 60 + nr * 2,
                            "color": color, "t_start": t
                        })
                entry = self._graph_ai_active_nodes[node]
                entry["intensity"] = min(1.0, entry["intensity"] + 0.15)
                entry["stage"] = active_stage
            else:
                if node in self._graph_ai_active_nodes:
                    entry = self._graph_ai_active_nodes[node]
                    entry["intensity"] -= 0.08
                    if entry["intensity"] <= 0:
                        del self._graph_ai_active_nodes[node]

        # Update scan waves
        self._graph_ai_scan_waves = [
            w for w in self._graph_ai_scan_waves
            if t - w["t_start"] < 1.2
        ]
        for w in self._graph_ai_scan_waves:
            elapsed = t - w["t_start"]
            w["r"] = w["max_r"] * (elapsed / 1.2)

        # Emit data trails between connected active nodes
        if self._anim_tick % 8 == 0:
            active_set = set(self._graph_ai_active_nodes.keys())
            for src, tgts in self.notes_graph.items():
                if src not in active_set or src not in self._graph_node_positions:
                    continue
                for tgt in tgts:
                    if tgt not in self._graph_node_positions:
                        continue
                    if tgt in active_set and random.random() < 0.3:
                        sx, sy, _ = self._graph_node_positions[src]
                        tx, ty, _ = self._graph_node_positions[tgt]
                        self._graph_ai_trails.append({
                            "x1": sx, "y1": sy, "x2": tx, "y2": ty,
                            "progress": 0.0, "color": color
                        })

        # Update trails
        new_trails = []
        for trail in self._graph_ai_trails:
            trail["progress"] += 0.05
            if trail["progress"] < 1.0:
                new_trails.append(trail)
        self._graph_ai_trails = new_trails[-30:]  # cap

    def _on_graph_click(self, event):
        self._graph_drag_node = None
        self._graph_dragged = False
        self._graph_press_node = None
        self._graph_press_xy = (event.x, event.y)
        for node, (nx, ny, r) in self._graph_node_positions.items():
            if (event.x - nx)**2 + (event.y - ny)**2 <= (r + 5)**2:
                self._graph_press_node = node
                return

    # ─── PIPELINE SCHEMA VIEW ────────────────────────────────────
    def _run_scenario(self, name):
        self.pipeline.start_scenario(name)
        self.schema_status.config(text=f"running: {name}...", fg=P["emerald"])
        self._update_schema_log()

    def _graph_run_scenario(self, name):
        """Start a pipeline scenario and visualize on graph."""
        self.pipeline.start_scenario(name)
        self._graph_ai_active_nodes.clear()
        self._graph_ai_scan_waves.clear()
        self._graph_ai_trails.clear()
        self._graph_ai_stage = "STARTING"
        self._graph_ai_stage_color = P["emerald"]
        self.graph_ai_status_lbl.config(text=f"running: {name}", fg=P["emerald"])
        self._draw_graph()

    def _graph_reset_ai(self):
        """Reset AI visualization on graph."""
        self.pipeline.reset()
        self._graph_ai_active_nodes.clear()
        self._graph_ai_scan_waves.clear()
        self._graph_ai_trails.clear()
        self._graph_ai_stage = ""
        self._graph_ai_stage_color = P["text_dim"]
        self.graph_ai_status_lbl.config(text="idle", fg=P["text_dim"])
        self._draw_graph()

    def _reset_schema(self):
        self.pipeline.reset()
        self.schema_status.config(text="reset — pick a scenario", fg=P["text_dim"])
        self._update_schema_log()
        self._draw_schema()

    def _on_schema_hover(self, event):
        """Show tooltip when hovering a pipeline node."""
        for node_id, (nx, ny, nw, nh) in self._schema_node_rects.items():
            if nx <= event.x <= nx + nw and ny <= event.y <= ny + nh:
                desc = ""
                for nid, _, _, d in PipelineSimulator.NODES:
                    if nid == node_id:
                        desc = d
                        break
                metric = self.pipeline.metrics.get(node_id, "")
                state = self.pipeline.node_states.get(node_id, "idle")
                tip = f"{desc}\nState: {state}"
                if metric:
                    tip += f"\n{metric}"
                self.schema_tooltip.config(text=tip)
                tx = min(event.x + 12, self.schema_canvas.winfo_width() - 240)
                ty = max(event.y - 60, 4)
                self.schema_tooltip.place(x=tx, y=ty)
                return
        self.schema_tooltip.place_forget()

    def _on_schema_click(self, event):
        """Select a pipeline node on click, show detail panel."""
        for node_id, (nx, ny, nw, nh) in self._schema_node_rects.items():
            if nx <= event.x <= nx + nw and ny <= event.y <= ny + nh:
                if self._selected_pipeline_node == node_id:
                    self._selected_pipeline_node = None  # toggle off
                else:
                    self._selected_pipeline_node = node_id
                self._draw_schema()
                return
        # Click on empty space — deselect
        if self._selected_pipeline_node is not None:
            self._selected_pipeline_node = None
            self._draw_schema()

    def _update_schema_log(self):
        """Refresh the event log text widget."""
        self.schema_log.config(state="normal")
        self.schema_log.delete("1.0", "end")
        for line in self.pipeline.event_log[-30:]:  # last 30 entries
            tag = None
            if "OK" in line or "done" in line:
                tag = "ok"
            elif "FAIL" in line or "!!" in line or "RETRY" in line:
                tag = "err" if "FAIL" in line else "warn"
            elif ">>" in line or "start" in line:
                tag = "info"
            self.schema_log.insert("end", line + "\n", tag if tag else ())
        self.schema_log.see("end")
        self.schema_log.config(state="disabled")

    def _draw_schema(self):
        c = self.schema_canvas
        c.delete("all")
        w = max(c.winfo_width(), 600)
        h = max(c.winfo_height(), 400)

        # Starfield background (twinkling pixel stars)
        self._starfield.draw(c, w, h, time.time())

        # Nebula clouds — colored blobs in schema background
        if not hasattr(self, '_schema_nebulae'):
            self._schema_nebulae = []
            neb_colors = [P["cyan_dim"], P["amethyst_dim"], P["rose_dim"]]
            for _ in range(3):
                self._schema_nebulae.append({
                    "x": random.uniform(0.2, 0.8),
                    "y": random.uniform(0.2, 0.8),
                    "r": random.uniform(60, 100),
                    "color": random.choice(neb_colors),
                    "phase": random.uniform(0, math.pi * 2),
                })
        _draw_nebulae(c, w, h, self._schema_nebulae, rings=3, opacity=0.03, t=time.time())

        # Subtle hex grid overlay
        for gx in range(0, w, 32):
            for gy in range(0, h, 32):
                offset = 16 if (gy // 32) % 2 else 0
                c.create_text(gx + offset, gy, text="·", font=(FONT, 6),
                             fill=P["border"], anchor="nw")

        # Ambient energy lines (horizontal scan lines)
        scan_y = int((time.time() * 30) % h)
        c.create_line(0, scan_y, w, scan_y, fill=P["border"], width=1, dash=(2, 8))
        c.create_line(0, (scan_y + h // 3) % h, w, (scan_y + h // 3) % h,
                     fill=P["border"], width=1, dash=(1, 12))

        # Title with glow effect
        c.create_text(w // 2 + 1, 21, text="SHUMILEK AI PIPELINE",
                     font=F_BIG, fill=P["amethyst_dim"])
        c.create_text(w // 2, 20, text="SHUMILEK AI PIPELINE",
                     font=F_BIG, fill=P["heading"])
        elapsed_txt = f"real-time workflow visualization"
        if self.pipeline.is_running:
            elapsed_txt += f"  |  elapsed: {self.pipeline.elapsed_time:.1f}s"
        c.create_text(w // 2, 42, text=elapsed_txt,
                     font=F_SMALL, fill=P["text_dim"])

        # Node layout — two rows with flow
        nodes = PipelineSimulator.NODES
        top_row = nodes[:5]   # context → routing → rozum → generate → guardian
        bot_row = nodes[5:]   # halluc → svedomi → decision → output

        node_w, node_h = 120, 60
        gap = 20
        total_top = len(top_row) * node_w + (len(top_row) - 1) * gap
        total_bot = len(bot_row) * node_w + (len(bot_row) - 1) * gap
        start_x_top = (w - total_top) // 2
        start_x_bot = (w - total_bot) // 2

        y_top = 90
        y_bot = 240
        self._schema_positions = {}

        # Helper: choose arrow color based on node states
        def _arrow_color(src_id, dst_id):
            ss = self.pipeline.node_states.get(src_id, "idle")
            ds = self.pipeline.node_states.get(dst_id, "idle")
            if ss == "done" and ds == "active":
                return P["cyan"]
            elif ss == "done" and ds == "done":
                return P["ok"]
            elif ds == "error":
                return P["err"]
            elif ss == "done":
                return P["text"]
            return P["text_dim"]

        def _draw_arrow(x1, y1, x2, y2, src_id, dst_id):
            """Draw a connection arrow with optional glow for active connections."""
            acol = _arrow_color(src_id, dst_id)
            ss = self.pipeline.node_states.get(src_id, "idle")
            ds = self.pipeline.node_states.get(dst_id, "idle")
            is_active = ss == "done" and ds == "active"
            # Glow behind active arrows
            if is_active:
                c.create_line(x1, y1, x2, y2,
                             fill=P["cyan_dim"], width=6, arrow="last",
                             arrowshape=(8, 10, 4))
            c.create_line(x1, y1, x2, y2,
                         fill=acol, width=3 if is_active else 2,
                         arrow="last", arrowshape=(6, 8, 3))
            # Animated energy dots on active arrows
            if is_active:
                seg_len = math.hypot(x2 - x1, y2 - y1)
                if seg_len > 5:
                    frac = (time.time() * 2) % 1.0
                    dx = x1 + (x2 - x1) * frac
                    dy = y1 + (y2 - y1) * frac
                    c.create_oval(dx - 3, dy - 3, dx + 3, dy + 3,
                                 fill=P["cyan"], outline=P["text_bright"], width=1)
                    # Second dot offset
                    frac2 = (frac + 0.5) % 1.0
                    dx2 = x1 + (x2 - x1) * frac2
                    dy2 = y1 + (y2 - y1) * frac2
                    c.create_oval(dx2 - 2, dy2 - 2, dx2 + 2, dy2 + 2,
                                 fill=P["cyan_dim"], outline="")

        # Draw top row
        for i, (nid, label, color_key, desc) in enumerate(top_row):
            x = start_x_top + i * (node_w + gap)
            self._draw_pipeline_node(c, x, y_top, node_w, node_h,
                                     nid, label, color_key, desc)
            self._schema_positions[nid] = (x + node_w // 2, y_top + node_h // 2)
            # Animated arrow to next
            if i < len(top_row) - 1:
                ax = x + node_w + 2
                ay = y_top + node_h // 2
                next_nid = top_row[i + 1][0]
                _draw_arrow(ax, ay, ax + gap - 4, ay, nid, next_nid)

        # Arrow from guardian down to halluc (L-shaped with glow)
        if "guardian" in self._schema_positions and len(bot_row) > 0:
            gx, gy = self._schema_positions["guardian"]
            hx = start_x_bot + node_w // 2
            acol = _arrow_color("guardian", "halluc")
            gs = self.pipeline.node_states.get("guardian", "idle")
            hs = self.pipeline.node_states.get("halluc", "idle")
            is_active = gs == "done" and hs == "active"
            lw = 3 if is_active else 2
            # Glow behind active connection
            if is_active:
                c.create_line(gx, gy + node_h // 2, gx, y_bot - 15,
                             fill=P["cyan_dim"], width=6, dash=(4, 4))
                c.create_line(gx, y_bot - 15, hx, y_bot - 15,
                             fill=P["cyan_dim"], width=6, dash=(4, 4))
                c.create_line(hx, y_bot - 15, hx, y_bot,
                             fill=P["cyan_dim"], width=6)
            # Vertical segment
            c.create_line(gx, gy + node_h // 2, gx, y_bot - 15,
                         fill=acol, width=lw, dash=(4, 4))
            # Horizontal segment
            c.create_line(gx, y_bot - 15, hx, y_bot - 15,
                         fill=acol, width=lw, dash=(4, 4))
            # Down into halluc
            c.create_line(hx, y_bot - 15, hx, y_bot,
                         fill=acol, width=lw, arrow="last", arrowshape=(6, 8, 3))
            # Corner dot
            c.create_oval(gx - 3, y_bot - 18, gx + 3, y_bot - 12,
                         fill=acol, outline="")
            c.create_oval(hx - 3, y_bot - 18, hx + 3, y_bot - 12,
                         fill=acol, outline="")
            # Energy dots traveling along L-path when active
            if is_active:
                t = time.time()
                # Total path: vertical + horizontal + vertical
                seg1 = abs(y_bot - 15 - (gy + node_h // 2))
                seg2 = abs(hx - gx)
                seg3 = 15
                total = seg1 + seg2 + seg3
                for phase_off in (0.0, 0.5):
                    frac = ((t * 0.8 + phase_off) % 1.0)
                    dist = frac * total
                    if dist < seg1:
                        dsx = gx
                        dsy = gy + node_h // 2 + dist
                    elif dist < seg1 + seg2:
                        dsx = gx + (hx - gx) * (dist - seg1) / max(seg2, 1)
                        dsy = y_bot - 15
                    else:
                        dsx = hx
                        dsy = y_bot - 15 + (dist - seg1 - seg2)
                    c.create_oval(int(dsx) - 4, int(dsy) - 4,
                                 int(dsx) + 4, int(dsy) + 4,
                                 fill=acol, outline=P["text_bright"])

        # Draw bottom row
        for i, (nid, label, color_key, desc) in enumerate(bot_row):
            x = start_x_bot + i * (node_w + gap)
            self._draw_pipeline_node(c, x, y_bot, node_w, node_h,
                                     nid, label, color_key, desc)
            self._schema_positions[nid] = (x + node_w // 2, y_bot + node_h // 2)
            if i < len(bot_row) - 1:
                ax = x + node_w + 2
                ay = y_bot + node_h // 2
                next_nid = bot_row[i + 1][0]
                _draw_arrow(ax, ay, ax + gap - 4, ay, nid, next_nid)

        # Retry feedback loop arrow (decision → generate) with glow
        if "decision" in self._schema_positions and "generate" in self._schema_positions:
            dx, dy = self._schema_positions["decision"]
            gx, gy = self._schema_positions["generate"]
            retry_y = y_bot + node_h // 2 + 40
            state = self.pipeline.node_states.get("decision", "idle")
            is_retry = state == "retry"
            loop_color = P["err"] if is_retry else P["border_glow"]
            lw = 3 if is_retry else 2
            # Glow behind active retry
            if is_retry:
                c.create_line(dx, dy + node_h // 2, dx, retry_y,
                             fill=P["rose_dim"], width=6, dash=(3, 3))
                c.create_line(dx, retry_y, gx, retry_y,
                             fill=P["rose_dim"], width=6, dash=(3, 3))
                c.create_line(gx, retry_y, gx, gy + node_h // 2,
                             fill=P["rose_dim"], width=6, dash=(3, 3))
            c.create_line(dx, dy + node_h // 2, dx, retry_y,
                         fill=loop_color, width=lw, dash=(3, 3))
            c.create_line(dx, retry_y, gx, retry_y,
                         fill=loop_color, width=lw, dash=(3, 3))
            c.create_line(gx, retry_y, gx, gy + node_h // 2,
                         fill=loop_color, width=lw, arrow="last",
                         arrowshape=(8, 10, 4), dash=(3, 3))
            # Corner dots
            c.create_oval(dx - 3, retry_y - 3, dx + 3, retry_y + 3,
                         fill=loop_color, outline="")
            c.create_oval(gx - 3, retry_y - 3, gx + 3, retry_y + 3,
                         fill=loop_color, outline="")
            # Energy dots along retry loop path when active
            if is_retry:
                t = time.time()
                seg1 = abs(retry_y - (dy + node_h // 2))
                seg2 = abs(gx - dx)
                seg3 = abs((gy + node_h // 2) - retry_y)
                total = seg1 + seg2 + seg3
                for phase_off in (0.0, 0.5):
                    frac = ((t * 1.2 + phase_off) % 1.0)
                    dist = frac * total
                    if dist < seg1:
                        dsx = dx
                        dsy = dy + node_h // 2 + dist
                    elif dist < seg1 + seg2:
                        dsx = dx + (gx - dx) * (dist - seg1) / max(seg2, 1)
                        dsy = retry_y
                    else:
                        dsx = gx
                        dsy = retry_y - (dist - seg1 - seg2)
                    c.create_oval(int(dsx) - 4, int(dsy) - 4,
                                 int(dsx) + 4, int(dsy) + 4,
                                 fill=loop_color, outline=P["text_bright"])
            c.create_text((dx + gx) // 2, retry_y + 12,
                         text="RETRY LOOP (max 3x)", font=F_PIXEL,
                         fill=loop_color)

        # User input (top)
        ux = start_x_top + node_w // 2
        c.create_rectangle(ux - 50, y_top - 40, ux + 50, y_top - 12,
                          fill=P["surface"], outline=P["border_glow"], width=2)
        c.create_text(ux, y_top - 26, text="USER INPUT",
                     font=F_SMALL, fill=P["text_bright"])
        c.create_line(ux, y_top - 12, ux, y_top,
                     fill=P["text_dim"], width=2, arrow="last", arrowshape=(6, 8, 3))

        # Output (bottom right)
        if "output" in self._schema_positions:
            ox, oy = self._schema_positions["output"]
            c.create_rectangle(ox - 55, oy + node_h // 2 + 10, ox + 55, oy + node_h // 2 + 38,
                              fill=P["surface"], outline=P["border_glow"], width=2)
            c.create_text(ox, oy + node_h // 2 + 24, text="FINAL ANSWER",
                         font=F_SMALL, fill=P["text_bright"])
            c.create_line(ox, oy + node_h // 2, ox, oy + node_h // 2 + 10,
                         fill=P["text_dim"], width=2, arrow="last", arrowshape=(6, 8, 3))

        # ── Active Hive Task Overlay (bottom-left) ──
        active_task = self._ai_processing_task
        if active_task:
            tp_w, tp_h = 280, 52
            tp_x, tp_y = 10, h - 90
            border_c = P["cyan"] if active_task["status"] == "running" else P["warn"]
            c.create_rectangle(tp_x, tp_y, tp_x + tp_w, tp_y + tp_h,
                              fill=P["panel"], outline=border_c, width=2)
            # Corner accents
            for (cx_, cy_) in [(tp_x, tp_y), (tp_x + tp_w - 4, tp_y),
                               (tp_x, tp_y + tp_h - 4), (tp_x + tp_w - 4, tp_y + tp_h - 4)]:
                c.create_rectangle(cx_, cy_, cx_ + 4, cy_ + 4,
                                  fill=border_c, outline="")
            # Pulsing dot
            pulse_dot = abs(math.sin(time.time() * 4))
            dot_r = 3 + int(pulse_dot * 2)
            c.create_oval(tp_x + 12 - dot_r, tp_y + 14 - dot_r,
                         tp_x + 12 + dot_r, tp_y + 14 + dot_r,
                         fill=P["emerald"], outline="")
            # Task kind & truncated text
            kind_label = active_task.get("kind", "task").upper()
            c.create_text(tp_x + 22, tp_y + 10,
                         text=f"\u25B6 {kind_label}", font=F_SMALL,
                         fill=border_c, anchor="nw")
            task_text = active_task.get("text", "")[:40]
            c.create_text(tp_x + 10, tp_y + 28,
                         text=task_text, font=F_PIXEL,
                         fill=P["text"], anchor="nw", width=tp_w - 20)
            # Progress bar
            prog = active_task.get("progress", 0) / 100
            bar_x = tp_x + 10
            bar_y = tp_y + tp_h - 8
            bar_w = tp_w - 20
            c.create_rectangle(bar_x, bar_y, bar_x + bar_w, bar_y + 4,
                              fill=P["panel_alt"], outline=P["border"])
            c.create_rectangle(bar_x, bar_y, bar_x + int(bar_w * prog), bar_y + 4,
                              fill=border_c, outline="")

        # Vignette overlay — dark edges for cinematic depth
        _draw_vignette(c, w, h, size=30)

        # Metrics panel
        self._draw_schema_metrics(c, w, h)

        # Selected node detail panel
        if self._selected_pipeline_node and self._selected_pipeline_node in self._schema_positions:
            sel_id = self._selected_pipeline_node
            # Find node info
            sel_desc = ""
            sel_label = sel_id
            sel_ck = "border_glow"
            for nid, lbl, ck, d in PipelineSimulator.NODES:
                if nid == sel_id:
                    sel_desc = d
                    sel_label = lbl
                    sel_ck = ck
                    break
            sel_state = self.pipeline.node_states.get(sel_id, "idle")
            sel_metric = self.pipeline.metrics.get(sel_id, "")
            sel_color = P.get(sel_ck, P["text"])

            # Panel dimensions and position (right side)
            pw, ph = 220, 100
            px = w - pw - 10
            py = 50
            # Background
            c.create_rectangle(px, py, px + pw, py + ph,
                              fill=P["panel"], outline=sel_color, width=2)
            # Corner accents
            for (cx_, cy_) in [(px, py), (px + pw - 5, py),
                               (px, py + ph - 5), (px + pw - 5, py + ph - 5)]:
                c.create_rectangle(cx_, cy_, cx_ + 5, cy_ + 5,
                                  fill=sel_color, outline="")
            # Title
            c.create_text(px + pw // 2, py + 14,
                         text=f"\u25C6 {sel_label}", font=F_HEAD,
                         fill=sel_color)
            # Description
            c.create_text(px + pw // 2, py + 34,
                         text=sel_desc, font=F_PIXEL, fill=P["text"],
                         width=pw - 20)
            # State
            state_col = P["ok"] if sel_state == "done" else (
                P["err"] if sel_state == "error" else (
                P["warn"] if sel_state == "retry" else (
                sel_color if sel_state == "active" else P["text_dim"])))
            c.create_text(px + pw // 2, py + 58,
                         text=f"State: {sel_state.upper()}", font=F_SMALL,
                         fill=state_col)
            # Metric
            if sel_metric:
                c.create_text(px + pw // 2, py + 76,
                             text=sel_metric, font=F_PIXEL, fill=P["text_dim"],
                             width=pw - 20)
            # Connections info
            conn_in = []
            conn_out = []
            node_ids = [n[0] for n in PipelineSimulator.NODES]
            idx = node_ids.index(sel_id) if sel_id in node_ids else -1
            if idx > 0:
                conn_in.append(node_ids[idx - 1])
            if idx >= 0 and idx < len(node_ids) - 1:
                conn_out.append(node_ids[idx + 1])
            conn_text = f"\u2190 {', '.join(conn_in)}" if conn_in else ""
            if conn_out:
                conn_text += f"  \u2192 {', '.join(conn_out)}"
            if conn_text:
                c.create_text(px + pw // 2, py + ph - 8,
                             text=conn_text, font=F_PIXEL, fill=P["text_dim"])

    def _draw_pipeline_node(self, c, x, y, w, h, node_id, label, color_key, desc):
        """Draw a single pipeline node with pixel art style."""
        state = self.pipeline.node_states.get(node_id, "idle")
        color = P[color_key]
        self._schema_node_rects[node_id] = (x, y, w, h)

        # Node icons
        _node_icons = {
            "context": "\u2630", "routing": "\u2794", "rozum": "\u2699",
            "generate": "\u270E", "guardian": "\u2696", "halluc": "\u2622",
            "svedomi": "\u2714", "decision": "\u21C4", "output": "\u2B50",
        }
        node_icon = _node_icons.get(node_id, "\u25CF")

        # State-dependent styling
        if state == "active":
            bg = P["surface"]
            border_c = color
            border_w = 3
            text_c = P["text_bright"]
        elif state == "done":
            bg = P["panel_alt"]
            border_c = P["ok"]
            border_w = 2
            text_c = P["ok"]
        elif state == "error":
            bg = P["panel_alt"]
            border_c = P["err"]
            border_w = 2
            text_c = P["err"]
        elif state == "retry":
            bg = P["panel_alt"]
            border_c = P["warn"]
            border_w = 2
            text_c = P["warn"]
        else:
            bg = P["panel"]
            border_c = P["border"]
            border_w = 1
            text_c = P["text_dim"]

        # Pulsing glow rings for active node
        if state == "active":
            pulse = abs(math.sin(time.time() * 3))
            # Multi-ring soft glow
            for ri in range(4):
                frac = 1.0 - ri / 4.0
                expand = 3 + ri * 3 + int(pulse * 4)
                c.create_rectangle(x - expand, y - expand, x + w + expand, y + h + expand,
                                  fill=_hex_color_scale(color, 0.12 * frac), outline="")
            # Outer animated glow ring
            expand = int(pulse * 6) + 3
            c.create_rectangle(x - expand, y - expand, x + w + expand, y + h + expand,
                              fill="", outline=color, width=1, dash=(3, 3))
            # Second ring
            expand2 = int(pulse * 3) + 1
            c.create_rectangle(x - expand2, y - expand2, x + w + expand2, y + h + expand2,
                              fill="", outline=color, width=2)
            # Corner energy sparks
            spark_len = int(pulse * 8) + 4
            for (cx_, cy_, dx, dy) in [(x, y, -1, -1), (x+w, y, 1, -1),
                                       (x, y+h, -1, 1), (x+w, y+h, 1, 1)]:
                c.create_line(cx_, cy_, cx_ + dx * spark_len, cy_ + dy * spark_len,
                             fill=color, width=1)
            # Ground shadow
            c.create_rectangle(x + 3, y + h + 2, x + w - 3, y + h + 5,
                              fill=P["void"], outline="")
        elif state == "done":
            # Soft completed glow halo
            for ri in range(3):
                frac = 1.0 - ri / 3.0
                expand = 2 + ri * 3
                c.create_rectangle(x - expand, y - expand, x + w + expand, y + h + expand,
                                  fill=_hex_color_scale(P["ok"], 0.08 * frac), outline="")
            c.create_rectangle(x - 2, y - 2, x + w + 2, y + h + 2,
                              fill="", outline=P["ok"], width=1, dash=(1, 4))

        # Main rectangle with gradient-like fill
        c.create_rectangle(x, y, x+w, y+h,
                          fill=bg, outline=border_c, width=border_w)

        # Inner gradient line (horizontal highlight near top)
        if state in ("active", "done"):
            hl_color = color if state == "active" else P["ok"]
            c.create_line(x + 4, y + 3, x + w - 4, y + 3,
                         fill=hl_color, width=1)

        # Pixel corner notches
        s = 4
        for (cx_, cy_) in [(x, y), (x+w-s, y), (x, y+h-s), (x+w-s, y+h-s)]:
            c.create_rectangle(cx_, cy_, cx_+s, cy_+s,
                              fill=border_c, outline="")

        # Node icon (left side)
        c.create_text(x + 14, y + h // 2,
                     text=node_icon, font=(FONT, 12),
                     fill=color if state in ("active", "idle") else text_c)

        # Label (right of icon)
        c.create_text(x + w // 2 + 8, y + h // 2 - 4,
                     text=label, font=F_SMALL, fill=text_c, justify="center")

        # State indicator
        if state == "active":
            # Animated progress bar inside node
            bar_y = y + h - 8
            bar_w = w - 10
            c.create_rectangle(x + 5, bar_y, x + 5 + bar_w, bar_y + 4,
                              fill=P["panel"], outline=P["border"])
            # Animated fill
            progress = abs(math.sin(time.time() * 2)) * bar_w
            c.create_rectangle(x + 5, bar_y, x + 5 + int(progress), bar_y + 4,
                              fill=color, outline="")
        elif state == "done":
            c.create_text(x + w - 12, y + 8, text="\u2713", font=F_SMALL, fill=P["ok"])
        elif state == "error":
            c.create_text(x + w - 12, y + 8, text="\u2717", font=F_SMALL, fill=P["err"])
        elif state == "retry":
            c.create_text(x + w - 12, y + 8, text="\u21BB", font=F_SMALL, fill=P["warn"])

        # Metric text below node
        metric = self.pipeline.metrics.get(node_id, "")
        if metric:
            c.create_text(x + w // 2, y + h + 10,
                         text=metric, font=F_PIXEL, fill=P["text_dim"],
                         width=w + 20)

        # Selected node highlight
        if self._selected_pipeline_node == node_id:
            c.create_rectangle(x - 4, y - 4, x + w + 4, y + h + 4,
                              fill="", outline=P["cyan"], width=2)
            c.create_rectangle(x - 6, y - 6, x + w + 6, y + h + 6,
                              fill="", outline=P["cyan_dim"], width=1, dash=(2, 2))

    def _draw_schema_metrics(self, c, w, h):
        """Draw metrics summary panel with animated progress bars."""
        mx = 10
        my = h - 80
        pw = 320
        ph = 74
        c.create_rectangle(mx, my, mx + pw, my + ph,
                          fill=P["surface"], outline=P["border"], width=1)
        # Corner accents
        for (cx, cy) in [(mx, my), (mx + pw, my), (mx, my + ph), (mx + pw, my + ph)]:
            c.create_rectangle(cx - 2, cy - 2, cx + 2, cy + 2,
                              fill=P["border_glow"], outline="")

        c.create_text(mx + 8, my + 8, text="◈ Pipeline Stats", font=F_SMALL,
                     fill=P["heading"], anchor="nw")

        total = len(PipelineSimulator.NODES)
        done_count = sum(1 for s in self.pipeline.node_states.values() if s == "done")
        err_count = sum(1 for s in self.pipeline.node_states.values() if s in ("error", "retry"))
        active_count = sum(1 for s in self.pipeline.node_states.values() if s == "active")
        retries = self.pipeline.retry_count

        # Progress bar
        bar_x = mx + 8
        bar_y = my + 28
        bar_w = pw - 16
        bar_h = 10
        c.create_rectangle(bar_x, bar_y, bar_x + bar_w, bar_y + bar_h,
                          fill=P["panel"], outline=P["border"])
        if total > 0:
            frac = done_count / total
            fill_w = int(bar_w * frac)
            if fill_w > 0:
                # Gradient-like segmented fill
                seg = max(1, fill_w // max(1, done_count))
                for i in range(done_count):
                    sx = bar_x + i * seg
                    color = P["ok"] if err_count == 0 else P["emerald"]
                    c.create_rectangle(sx, bar_y + 1, sx + seg - 1, bar_y + bar_h - 1,
                                      fill=color, outline="")
            # Active pulse segment
            if active_count > 0 and fill_w < bar_w:
                pulse = abs(math.sin(time.time() * 4)) * 0.5 + 0.5
                aw = max(4, seg if done_count > 0 else int(bar_w / total))
                ac = P["cyan"] if pulse > 0.5 else P["cyan_dim"]
                c.create_rectangle(bar_x + fill_w, bar_y + 1,
                                  bar_x + fill_w + aw, bar_y + bar_h - 1,
                                  fill=ac, outline="")

        pct = int(done_count / total * 100) if total > 0 else 0
        c.create_text(bar_x + bar_w + 4, bar_y + 5, text=f"{pct}%",
                     font=F_PIXEL, fill=P["text_bright"], anchor="w")

        stat_text = f"Done: {done_count}/{total}  Active: {active_count}  Err: {err_count}  Retries: {retries}"
        c.create_text(mx + 8, my + 46, text=stat_text, font=F_PIXEL,
                     fill=P["text"], anchor="nw")

        if self.pipeline.elapsed_time > 0:
            c.create_text(mx + 8, my + 60, text=f"Elapsed: {self.pipeline.elapsed_time:.1f}s",
                         font=F_PIXEL, fill=P["text_dim"], anchor="nw")

    # ─── NOTE CARDS GALLERY VIEW ───────────────────────────────
    def _show_cards(self):
        """Switch to cards gallery view showing notes as visual cards."""
        self._hide_all_views()
        self.cards_frame.pack(fill="both", expand=True, padx=4, pady=4)
        self.view_mode = "cards"
        self.view_indicator.config(text="CARDS", fg=P["ice"])
        self.status_left.config(text=f"note cards \u2014 {len(self._all_files)} notes \u2014 click to open")
        self.root.after(50, self._draw_cards)

    def _draw_cards(self):
        c = self.cards_canvas
        c.delete("all")
        w = max(c.winfo_width(), 400)
        h = max(c.winfo_height(), 300)
        self._card_rects.clear()

        # Pixel grid background
        for gx in range(0, w, 48):
            c.create_line(gx, 0, gx, h, fill=P["border"], width=1, dash=(1, 16))
        for gy in range(0, h, 48):
            c.create_line(0, gy, w, gy, fill=P["border"], width=1, dash=(1, 16))

        c.create_text(10, 10, text="Note Cards Gallery", font=F_HEAD,
                     fill=P["heading"], anchor="nw")
        c.create_text(10, 28, text=f"{len(self._all_files)} notes in vault",
                     font=F_PIXEL, fill=P["text_dim"], anchor="nw")

        # Card layout
        card_w, card_h = 180, 120
        gap = 16
        cols = max(1, (w - 20) // (card_w + gap))
        start_x = max(10, (w - cols * (card_w + gap) + gap) // 2)
        start_y = 50

        # Mood colors for notes
        mood_colors = [P["cyan_dim"], P["amethyst_dim"], P["ice"],
                       P["emerald"], P["ember"], P["rose"], P["teal"]]

        for idx, fp in enumerate(self._all_files):
            col = idx % cols
            row = idx // cols
            x = start_x + col * (card_w + gap)
            y = start_y + row * (card_h + gap)
            if y > h + card_h:
                break

            # Read note metadata
            content = self._read_cached(fp)
            words = len(content.split())
            lines_count = content.count("\n") + 1
            tags = re.findall(r'#(\w[\w-]*)', content)
            links = re.findall(r'\[\[([^\]]+)\]\]', content)
            is_pinned = fp.stem in self._pinned
            is_active = self.current_file and fp == self.current_file

            # Card color based on content hash
            mood_idx = hash(fp.stem) % len(mood_colors)
            mood = mood_colors[mood_idx]

            # Card background
            bg = P["surface"] if is_active else P["panel"]
            border_c = P["cyan"] if is_active else mood
            border_w = 2 if is_active else 1

            c.create_rectangle(x, y, x + card_w, y + card_h,
                              fill=bg, outline=border_c, width=border_w)

            # Pixel corner notches
            ns = 3
            for (cx, cy) in [(x, y), (x+card_w-ns, y), (x, y+card_h-ns), (x+card_w-ns, y+card_h-ns)]:
                c.create_rectangle(cx, cy, cx+ns, cy+ns, fill=border_c, outline="")

            # Top color stripe
            c.create_rectangle(x+1, y+1, x+card_w-1, y+6, fill=mood, outline="")

            # Title
            title = fp.stem
            if len(title) > 18:
                title = title[:17] + "\u2026"
            pin_prefix = "\u2605 " if is_pinned else ""
            c.create_text(x + 8, y + 16, text=f"{pin_prefix}{title}",
                         font=(FONT, 9, "bold"), fill=P["text_bright"],
                         anchor="nw", width=card_w - 16)

            # Preview snippet (first meaningful line)
            preview = ""
            for ln in content.split("\n"):
                stripped = ln.strip()
                if stripped and not stripped.startswith("#"):
                    preview = stripped[:60]
                    if len(stripped) > 60:
                        preview += "\u2026"
                    break
            if preview:
                c.create_text(x + 8, y + 34, text=preview,
                             font=F_PIXEL, fill=P["text_dim"],
                             anchor="nw", width=card_w - 16)

            # Stats bar at bottom
            stats_y = y + card_h - 20
            c.create_line(x + 4, stats_y - 2, x + card_w - 4, stats_y - 2,
                         fill=P["border"], width=1)
            c.create_text(x + 8, stats_y + 4, text=f"{words}w",
                         font=F_PIXEL, fill=P["text_dim"], anchor="nw")
            c.create_text(x + 50, stats_y + 4, text=f"{len(links)}lnk",
                         font=F_PIXEL, fill=P["cyan_dim"], anchor="nw")
            if tags:
                tag_str = "#" + tags[0] if tags else ""
                c.create_text(x + card_w - 8, stats_y + 4, text=tag_str,
                             font=F_PIXEL, fill=P["tag"], anchor="ne")

            self._card_rects[fp.stem] = (x, y, card_w, card_h)

    def _on_card_click(self, event):
        for stem, (x, y, w, h) in self._card_rects.items():
            if x <= event.x <= x + w and y <= event.y <= y + h:
                target = self.vault_path / f"{stem}.md"
                if not target.exists():
                    for fp in self._all_files:
                        if fp.stem == stem:
                            target = fp
                            break
                if target.exists():
                    self._show_editor()
                    self._open_file(target)
                return

    def _on_card_hover(self, event):
        """Highlight card under cursor."""
        for stem, (x, y, w, h) in self._card_rects.items():
            if x <= event.x <= x + w and y <= event.y <= y + h:
                if stem != self._card_hover_stem:
                    self._card_hover_stem = stem
                    self.cards_canvas.delete("hover_glow")
                    self.cards_canvas.create_rectangle(
                        x - 2, y - 2, x + w + 2, y + h + 2,
                        fill="", outline=P["cyan"], width=2,
                        dash=(4, 2), tags="hover_glow")
                return
        if self._card_hover_stem:
            self._card_hover_stem = None
            self.cards_canvas.delete("hover_glow")

    def _on_card_leave(self, event):
        """Remove card hover highlight."""
        self._card_hover_stem = None
        self.cards_canvas.delete("hover_glow")

    # ─── QUICK SWITCHER (FUZZY FINDER) ───────────────────────────
    def _show_quick_switcher(self):
        """Popup fuzzy file finder for fast note navigation."""
        all_notes = sorted(self._all_files, key=lambda f: f.stem.lower())

        win = tk.Toplevel(self.root)
        win.overrideredirect(True)
        win.configure(bg=P["border_glow"])
        rw, rh = 440, 340
        rx = max(0, self.root.winfo_x() + (self.root.winfo_width() - rw) // 2)
        ry = max(0, self.root.winfo_y() + 80)
        win.geometry(f"{rw}x{rh}+{rx}+{ry}")
        self._prepare_modal(win)

        inner = tk.Frame(win, bg=P["surface"], padx=2, pady=2)
        inner.pack(fill="both", expand=True, padx=1, pady=1)

        tk.Label(inner, text="\u25c8 Quick Switcher", font=F_SMALL,
                 fg=P["heading"], bg=P["surface"]).pack(padx=8, pady=(6, 2), anchor="w")

        search_var = tk.StringVar()
        entry = tk.Entry(inner, textvariable=search_var,
                         font=F_MONO, bg=P["panel"], fg=P["text"],
                         insertbackground=P["cyan"], bd=0,
                         highlightthickness=2, highlightcolor=P["cyan"],
                         highlightbackground=P["border"])
        entry.pack(fill="x", padx=6, pady=(4, 4))
        entry.focus_set()

        results_lb = tk.Listbox(inner, font=F_MONO, bg=P["panel"], fg=P["text"],
                                selectbackground=P["hover"], selectforeground=P["cyan"],
                                activestyle="none", bd=0, highlightthickness=0,
                                relief="flat", cursor="hand2")
        results_lb.pack(fill="both", expand=True, padx=6, pady=(2, 8))

        filtered: list[Path] = list(all_notes)

        def fuzzy_match(query: str, name: str) -> bool:
            qi = 0
            for ch in name:
                if qi < len(query) and ch == query[qi]:
                    qi += 1
            return qi == len(query)

        def refresh_list(*_):
            q = search_var.get().lower()
            results_lb.delete(0, "end")
            filtered.clear()
            for fp in all_notes:
                name_lower = fp.stem.lower()
                if not q or q in name_lower or fuzzy_match(q, name_lower):
                    filtered.append(fp)
                    # Show relative path for nested files
                    try:
                        rel = fp.relative_to(self.vault_path)
                        display = str(rel).replace(".md", "")
                    except ValueError:
                        display = fp.stem
                    pin = "\u2605 " if fp.stem in self._pinned else "  "
                    results_lb.insert("end", f"{pin}{display}")
            if filtered:
                results_lb.selection_set(0)

        def open_selected(*_):
            sel = results_lb.curselection()
            if sel and sel[0] < len(filtered):
                fp = filtered[sel[0]]
                self._close_modal_window(win)
                self._show_editor()
                self._open_file(fp)
            else:
                self._close_modal_window(win)

        def on_key(event):
            if event.keysym == "Escape":
                win.destroy()
            elif event.keysym == "Return":
                open_selected()
            elif event.keysym == "Down":
                cur = results_lb.curselection()
                idx = (cur[0] + 1) if cur else 0
                if idx < results_lb.size():
                    results_lb.selection_clear(0, "end")
                    results_lb.selection_set(idx)
                    results_lb.see(idx)
            elif event.keysym == "Up":
                cur = results_lb.curselection()
                idx = (cur[0] - 1) if cur else 0
                if idx >= 0:
                    results_lb.selection_clear(0, "end")
                    results_lb.selection_set(idx)
                    results_lb.see(idx)

        search_var.trace_add("write", refresh_list)
        entry.bind("<KeyPress>", on_key)
        results_lb.bind("<Double-Button-1>", open_selected)
        refresh_list()

    # ─── TRASH / ARCHIVE ─────────────────────────────────────────
    def _show_trash(self):
        """Show trashed notes with restore option."""
        trashed = sorted(self._trash_path.glob("*.md"), key=lambda f: f.stat().st_mtime, reverse=True)

        win = tk.Toplevel(self.root)
        win.title("Trash")
        win.geometry("400x420")
        win.configure(bg=P["panel"])
        self._prepare_modal(win)

        tk.Label(win, text="\U0001f5d1 TRASH", font=F_HEAD,
                 fg=P["heading"], bg=P["panel"]).pack(pady=(12, 4))
        tk.Label(win, text=f"{len(trashed)} trashed notes", font=F_PIXEL,
                 fg=P["text_dim"], bg=P["panel"]).pack(pady=(0, 8))

        list_frame = tk.Frame(win, bg=P["panel"])
        list_frame.pack(fill="both", expand=True, padx=12, pady=4)
        trash_lb = tk.Listbox(list_frame, font=F_MONO, bg=P["surface"], fg=P["text"],
                              selectbackground=P["hover"], selectforeground=P["cyan"],
                              activestyle="none", bd=0, highlightthickness=0,
                              relief="flat", cursor="hand2")
        trash_lb.pack(fill="both", expand=True)
        for fp in trashed:
            mod_time = datetime.datetime.fromtimestamp(fp.stat().st_mtime).strftime("%Y-%m-%d %H:%M")
            trash_lb.insert("end", f"  {fp.stem}  ({mod_time})")

        btn_frame = tk.Frame(win, bg=P["panel"])
        btn_frame.pack(fill="x", padx=12, pady=8)

        def restore():
            sel = trash_lb.curselection()
            if not sel:
                return
            idx = sel[0]
            if idx >= len(trashed):
                return
            fp = trashed[idx]
            dest = self.vault_path / fp.name
            if dest.exists():
                dest = self.vault_path / f"{fp.stem}_restored_{int(time.time())}.md"
            try:
                import shutil
                shutil.move(str(fp), str(dest))
            except OSError as e:
                messagebox.showerror("Restore Error", f"Cannot restore:\n{e}")
                return
            trashed.pop(idx)
            trash_lb.delete(idx)
            self._importance_cache.clear()
            self._refresh_file_tree()
            self._rebuild_graph_data()
            self._update_vault_stats()
            self.status_left.config(text=f"restored: {dest.stem}")

        def permanent_delete():
            sel = trash_lb.curselection()
            if not sel:
                return
            idx = sel[0]
            if idx >= len(trashed):
                return
            fp = trashed[idx]
            if messagebox.askyesno("Permanent Delete?",
                                   f"Permanently delete '{fp.stem}'?\nThis cannot be undone."):
                try:
                    fp.unlink()
                except OSError as e:
                    messagebox.showerror("Delete Error", f"Cannot delete:\n{e}")
                    return
                trashed.pop(idx)
                trash_lb.delete(idx)

        def empty_trash():
            if not trashed:
                return
            if messagebox.askyesno("Empty Trash?",
                                   f"Permanently delete all {len(trashed)} trashed notes?"):
                failed = []
                for fp in list(trashed):
                    try:
                        fp.unlink()
                        trashed.remove(fp)
                    except OSError:
                        failed.append(fp.stem)
                trash_lb.delete(0, "end")
                for fp in trashed:
                    mod_time = datetime.datetime.fromtimestamp(fp.stat().st_mtime).strftime("%Y-%m-%d %H:%M")
                    trash_lb.insert("end", f"  {fp.stem}  ({mod_time})")
                if failed:
                    messagebox.showwarning("Warning", f"Could not delete: {', '.join(failed)}")

        tk.Button(btn_frame, text="\u21a9 Restore", font=F_SMALL,
                  fg=P["emerald"], bg=P["surface"],
                  activebackground=P["hover"], bd=0,
                  command=restore, cursor="hand2").pack(side="left", padx=4)
        tk.Button(btn_frame, text="\U0001f5d1 Delete", font=F_SMALL,
                  fg=P["rose"], bg=P["surface"],
                  activebackground=P["hover"], bd=0,
                  command=permanent_delete, cursor="hand2").pack(side="left", padx=4)
        tk.Button(btn_frame, text="Empty Trash", font=F_SMALL,
                  fg=P["err"], bg=P["surface"],
                  activebackground=P["hover"], bd=0,
                  command=empty_trash, cursor="hand2").pack(side="left", padx=4)
        tk.Button(btn_frame, text="Close", font=F_SMALL,
                  fg=P["text_dim"], bg=P["surface"],
                  activebackground=P["hover"], bd=0,
                  command=lambda: self._close_modal_window(win), cursor="hand2").pack(side="right", padx=4)

    # ─── TAG CLOUD ───────────────────────────────────────────────
    def _draw_tag_cloud(self):
        """Draw visual weighted tag cloud on the tag_cloud_canvas."""
        cc = self.tag_cloud_canvas
        cc.delete("all")
        cw = max(cc.winfo_width(), 100)

        # Collect tag frequencies
        tag_counts: dict[str, int] = defaultdict(int)
        for fp in self._all_files:
            content = self._read_cached(fp)
            for t in re.findall(r'#(\w[\w-]*)', content):
                tag_counts[t] += 1

        if not tag_counts:
            cc.create_text(cw // 2, 35, text="no tags yet", font=F_PIXEL,
                          fill=P["text_dim"])
            return

        sorted_tags = sorted(tag_counts.items(), key=lambda x: -x[1])[:20]
        max_count = max(c for _, c in sorted_tags)
        min_count = min(c for _, c in sorted_tags)

        # Color palette for tags
        tag_palette = [P["amethyst"], P["cyan"], P["ice"], P["emerald"],
                       P["teal"], P["rose"], P["ember"]]

        self._tag_cloud_items.clear()
        x, y = 6, 6
        line_h = 0
        for i, (tag, count) in enumerate(sorted_tags):
            # Size based on frequency
            if max_count > min_count:
                norm = (count - min_count) / (max_count - min_count)
            else:
                norm = 0.5
            font_size = max(7, min(12, int(7 + norm * 5)))
            color = tag_palette[i % len(tag_palette)]

            tag_text = f"#{tag}"
            # Estimate width
            est_w = len(tag_text) * (font_size * 0.65) + 8
            if x + est_w > cw - 6:
                x = 6
                y += line_h + 4
                line_h = 0

            tid = cc.create_text(x, y, text=tag_text, font=(FONT, font_size),
                                fill=color, anchor="nw")
            bbox = cc.bbox(tid)
            if bbox:
                self._tag_cloud_items.append((tag, bbox[0], bbox[1], bbox[2], bbox[3]))
                x = bbox[2] + 6
                line_h = max(line_h, bbox[3] - bbox[1])

        # Resize canvas to fit
        total_h = y + line_h + 8
        cc.configure(height=max(40, min(90, total_h)))

    def _on_tag_cloud_click(self, event):
        """Open note search filtered by clicked tag."""
        for tag, x1, y1, x2, y2 in self._tag_cloud_items:
            if x1 <= event.x <= x2 and y1 <= event.y <= y2:
                self._on_tag_select_by_name(tag)
                return

    def _on_tag_select_by_name(self, tag: str):
        """Filter file list to notes containing the given tag."""
        self.sidebar_search_var.set(f"#{tag}")

    # ─── MARKDOWN TABLE INSERTER ─────────────────────────────────
    def _insert_table(self):
        """Show a visual grid picker to insert a markdown table."""
        win = tk.Toplevel(self.root)
        win.overrideredirect(True)
        win.configure(bg=P["border_glow"])
        rw, rh = 260, 260
        rx = max(0, self.root.winfo_x() + (self.root.winfo_width() - rw) // 2)
        ry = max(0, self.root.winfo_y() + 100)
        win.geometry(f"{rw}x{rh}+{rx}+{ry}")
        self._prepare_modal(win)

        inner = tk.Frame(win, bg=P["surface"], padx=2, pady=2)
        inner.pack(fill="both", expand=True, padx=1, pady=1)

        tk.Label(inner, text="\u25a6 Insert Table", font=F_SMALL,
                 fg=P["heading"], bg=P["surface"]).pack(padx=8, pady=(6, 2), anchor="w")

        size_label = tk.Label(inner, text="0 x 0", font=F_PIXEL,
                              fg=P["cyan"], bg=P["surface"])
        size_label.pack(pady=(0, 4))

        max_rows, max_cols = 8, 8
        cell_size = 24
        grid_canvas = tk.Canvas(inner, width=max_cols * cell_size + 4,
                                height=max_rows * cell_size + 4,
                                bg=P["panel"], highlightthickness=0)
        grid_canvas.pack(padx=8, pady=4)

        hover_r, hover_c = [0], [0]

        def draw_grid():
            grid_canvas.delete("all")
            for r in range(max_rows):
                for c in range(max_cols):
                    x1 = c * cell_size + 2
                    y1 = r * cell_size + 2
                    x2 = x1 + cell_size - 2
                    y2 = y1 + cell_size - 2
                    if r < hover_r[0] and c < hover_c[0]:
                        fill = P["cyan_dim"]
                        outline = P["cyan"]
                    else:
                        fill = P["surface"]
                        outline = P["border"]
                    grid_canvas.create_rectangle(x1, y1, x2, y2,
                                                 fill=fill, outline=outline)

        def on_motion(event):
            c = min(max_cols, max(1, (event.x - 2) // cell_size + 1))
            r = min(max_rows, max(1, (event.y - 2) // cell_size + 1))
            if c != hover_c[0] or r != hover_r[0]:
                hover_c[0] = c
                hover_r[0] = r
                size_label.config(text=f"{r} x {c}")
                draw_grid()

        def on_click(event):
            rows = max(1, hover_r[0])
            cols = max(1, hover_c[0])
            self._close_modal_window(win)
            self._do_insert_table(rows, cols)

        grid_canvas.bind("<Motion>", on_motion)
        grid_canvas.bind("<Button-1>", on_click)
        draw_grid()

        # Quick size buttons
        qf = tk.Frame(inner, bg=P["surface"])
        qf.pack(fill="x", padx=8, pady=(4, 6))
        for label, r, c in [("2x2", 2, 2), ("3x3", 3, 3), ("2x4", 2, 4), ("4x3", 4, 3)]:
            tk.Button(qf, text=label, font=F_PIXEL,
                      fg=P["text_dim"], bg=P["panel"],
                      activebackground=P["hover"], activeforeground=P["cyan"],
                      bd=0, cursor="hand2",
                      command=lambda r=r, c=c: (self._close_modal_window(win), self._do_insert_table(r, c))
            ).pack(side="left", padx=3)

    def _do_insert_table(self, rows: int, cols: int):
        """Insert a markdown table at the cursor position."""
        if not self.current_file:
            return
        header = "| " + " | ".join(f"Col {i+1}" for i in range(cols)) + " |"
        sep = "| " + " | ".join("---" for _ in range(cols)) + " |"
        body_lines = []
        for _ in range(rows):
            body_lines.append("| " + " | ".join("   " for _ in range(cols)) + " |")
        table_text = "\n".join([header, sep] + body_lines) + "\n"
        self.editor.insert("insert", table_text)
        self._apply_syntax()
        self.status_left.config(text=f"inserted {rows}x{cols} table")

    # ─── NOTE LINK HOVER PREVIEW ─────────────────────────────────
    def _on_editor_motion(self, event):
        """Show preview tooltip when hovering over [[wiki-links]]."""
        try:
            idx = self.editor.index(f"@{event.x},{event.y}")
        except Exception:
            return
        li = int(idx.split(".")[0])
        col = int(idx.split(".")[1])
        line = self.editor.get(f"{li}.0", f"{li}.end")

        # Find if cursor is inside a [[link]]
        link_name = None
        for m in re.finditer(r'\[\[([^\]]+)\]\]', line):
            if m.start() <= col <= m.end():
                link_name = m.group(1)
                break

        if link_name:
            if self._link_preview_after_id:
                self.root.after_cancel(self._link_preview_after_id)
            self._link_preview_after_id = self.root.after(
                300, lambda: self._show_link_preview(link_name, event))
        else:
            self._hide_link_preview()

    def _show_link_preview(self, link_name: str, event):
        """Display a floating preview of the linked note."""
        self._hide_link_preview()

        # Find the linked file
        target = None
        for fp in self._all_files:
            if fp.stem.lower() == link_name.lower():
                target = fp
                break
        if not target or not target.exists():
            return

        try:
            content = target.read_text(encoding="utf-8")
        except Exception:
            return

        # Take first 8 lines as preview
        preview_lines = content.split("\n")[:8]
        preview = "\n".join(preview_lines)
        if len(content.split("\n")) > 8:
            preview += "\n..."
        words = len(content.split())

        win = tk.Toplevel(self.root)
        win.overrideredirect(True)
        win.configure(bg=P["border_glow"])
        self._link_preview_win = win

        inner = tk.Frame(win, bg=P["surface"], padx=1, pady=1)
        inner.pack(fill="both", expand=True, padx=1, pady=1)

        tk.Label(inner, text=f"\u25c8 {link_name}", font=(FONT, 9, "bold"),
                 fg=P["heading"], bg=P["surface"], anchor="w").pack(
                     fill="x", padx=6, pady=(4, 0))
        tk.Label(inner, text=f"{words} words", font=F_PIXEL,
                 fg=P["text_dim"], bg=P["surface"], anchor="w").pack(
                     fill="x", padx=6, pady=(0, 2))

        txt = tk.Text(inner, font=(FONT, 8), bg=P["panel"], fg=P["text"],
                      bd=0, padx=6, pady=4, wrap="word", height=6, width=40,
                      highlightthickness=0, relief="flat", state="normal")
        txt.pack(fill="both", expand=True, padx=4, pady=(0, 4))
        txt.insert("1.0", preview)
        txt.config(state="disabled")

        # Position near cursor
        try:
            bbox = self.editor.bbox(self.editor.index(f"@{event.x},{event.y}"))
            if bbox:
                ex, ey = self.editor.winfo_rootx() + bbox[0], self.editor.winfo_rooty() + bbox[1]
                win.geometry(f"+{ex + 20}+{ey + 20}")
            else:
                win.geometry(f"+{event.x_root + 16}+{event.y_root + 16}")
        except Exception:
            win.geometry(f"+{event.x_root + 16}+{event.y_root + 16}")

        win.after(3000, self._hide_link_preview)

    def _hide_link_preview(self):
        """Dismiss the link preview tooltip."""
        if self._link_preview_after_id:
            self.root.after_cancel(self._link_preview_after_id)
            self._link_preview_after_id = None
        if self._link_preview_win:
            try:
                self._link_preview_win.destroy()
            except Exception:
                pass
            self._link_preview_win = None

    # ─── WRITING STATISTICS DASHBOARD ────────────────────────────
    def _show_writing_stats(self):
        """Popup showing detailed vault writing analytics."""
        win = tk.Toplevel(self.root)
        win.title("Writing Statistics")
        win.geometry("480x520")
        win.configure(bg=P["panel"])
        self._prepare_modal(win)

        tk.Label(win, text="\u25c8 WRITING STATISTICS", font=F_HEAD,
                 fg=P["heading"], bg=P["panel"]).pack(pady=(12, 4))

        # Gather stats
        note_data: list[tuple[str, int, int, int, str]] = []  # (name, words, lines, links, modified)
        total_words = 0
        total_links = 0
        total_tags_count = 0
        tag_set: set[str] = set()
        longest_note = ("", 0)
        shortest_note = ("", 999999)

        for fp in self._all_files:
            content = self._read_cached(fp)
            words = len(content.split())
            lines = content.count("\n") + 1
            links = len(re.findall(r'\[\[([^\]]+)\]\]', content))
            tags = re.findall(r'#(\w[\w-]*)', content)
            try:
                mod = datetime.datetime.fromtimestamp(fp.stat().st_mtime).strftime("%Y-%m-%d")
            except Exception:
                mod = "?"
            note_data.append((fp.stem, words, lines, links, mod))
            total_words += words
            total_links += links
            total_tags_count += len(tags)
            tag_set.update(tags)
            if words > longest_note[1]:
                longest_note = (fp.stem, words)
            if words < shortest_note[1]:
                shortest_note = (fp.stem, words)

        n_notes = len(self._all_files)
        avg_words = total_words // max(1, n_notes)

        # Summary frame
        sf = tk.Frame(win, bg=P["surface"])
        sf.pack(fill="x", padx=16, pady=8)
        stats_items = [
            ("Total Notes", str(n_notes)),
            ("Total Words", f"{total_words:,}"),
            ("Avg Words/Note", str(avg_words)),
            ("Total Links", str(total_links)),
            ("Unique Tags", str(len(tag_set))),
            ("Longest Note", f"{longest_note[0]} ({longest_note[1]}w)"),
            ("Shortest Note", f"{shortest_note[0]} ({shortest_note[1]}w)" if n_notes else "—"),
        ]
        for label, val in stats_items:
            row = tk.Frame(sf, bg=P["surface"])
            row.pack(fill="x", padx=8, pady=1)
            tk.Label(row, text=f"  {label}:", font=F_SMALL,
                     fg=P["text_dim"], bg=P["surface"], anchor="w", width=18).pack(side="left")
            tk.Label(row, text=val, font=F_SMALL,
                     fg=P["cyan"], bg=P["surface"], anchor="e").pack(side="right", padx=8)

        # Word distribution chart (bar chart on canvas)
        tk.Label(win, text="Word Count Distribution", font=F_SMALL,
                 fg=P["amethyst"], bg=P["panel"]).pack(pady=(8, 2))
        chart = tk.Canvas(win, height=140, bg=P["surface"], highlightthickness=0)
        chart.pack(fill="x", padx=16, pady=4)
        chart.update_idletasks()
        cw = max(chart.winfo_width(), 400)
        ch = 140

        if note_data:
            sorted_notes = sorted(note_data, key=lambda x: -x[1])[:15]
            max_w = max(d[1] for d in sorted_notes) if sorted_notes else 1
            bar_h = max(6, min(14, (ch - 20) // len(sorted_notes)))
            bar_colors = [P["cyan"], P["emerald"], P["amethyst"], P["ice"],
                          P["teal"], P["ember"], P["rose"]]
            for i, (name, words, _lines, _links, _mod) in enumerate(sorted_notes):
                y = 8 + i * (bar_h + 2)
                bar_w = max(4, int((words / max(1, max_w)) * (cw - 120)))
                color = bar_colors[i % len(bar_colors)]
                chart.create_rectangle(80, y, 80 + bar_w, y + bar_h,
                                       fill=color, outline="")
                # Pixel corner: tiny notch
                chart.create_rectangle(80 + bar_w - 2, y, 80 + bar_w, y + 2,
                                       fill=P["text_bright"], outline="")
                disp_name = name[:10] + "\u2026" if len(name) > 10 else name
                chart.create_text(76, y + bar_h // 2, text=disp_name,
                                  font=F_PIXEL, fill=P["text"], anchor="e")
                chart.create_text(84 + bar_w, y + bar_h // 2, text=f"{words}",
                                  font=F_PIXEL, fill=P["text_dim"], anchor="w")

        # Top linked notes
        tk.Label(win, text="Most Linked Notes", font=F_SMALL,
                 fg=P["ice"], bg=P["panel"]).pack(pady=(8, 2))
        linked_frame = tk.Frame(win, bg=P["panel"])
        linked_frame.pack(fill="x", padx=16, pady=4)
        linked_sorted = sorted(note_data, key=lambda x: -x[3])[:5]
        for name, _words, _lines, links, _mod in linked_sorted:
            if links > 0:
                row = tk.Frame(linked_frame, bg=P["panel"])
                row.pack(fill="x", pady=1)
                tk.Label(row, text=f"  \u25c8 {name}", font=F_PIXEL,
                         fg=P["text"], bg=P["panel"], anchor="w").pack(side="left")
                tk.Label(row, text=f"{links} links", font=F_PIXEL,
                         fg=P["cyan_dim"], bg=P["panel"]).pack(side="right", padx=8)

        tk.Button(win, text="Close", font=F_SMALL,
                  fg=P["text_dim"], bg=P["surface"],
                  activebackground=P["hover"], bd=0,
                  command=lambda: self._close_modal_window(win), cursor="hand2").pack(pady=8)

    # ─── BOOKMARK SYSTEM ─────────────────────────────────────────
    def _toggle_bookmark(self):
        """Add or remove a bookmark at the current cursor line."""
        if not self.current_file:
            return
        stem = self.current_file.stem
        try:
            idx = self.editor.index("insert")
            line_num = int(idx.split(".")[0])
        except Exception:
            return

        line_text = self.editor.get(f"{line_num}.0", f"{line_num}.end").strip()
        label = line_text[:30] if line_text else f"Line {line_num}"

        if stem not in self._bookmarks:
            self._bookmarks[stem] = []

        # Check if bookmark already exists at this line
        existing = [i for i, (ln, _) in enumerate(self._bookmarks[stem]) if ln == line_num]
        if existing:
            self._bookmarks[stem].pop(existing[0])
            self.status_left.config(text=f"bookmark removed: L{line_num}")
        else:
            self._bookmarks[stem].append((line_num, label))
            self.status_left.config(text=f"bookmark added: L{line_num} \u2014 {label}")

        self._apply_syntax()

    def _show_bookmarks(self):
        """Show all bookmarks for the current note, and global bookmarks."""
        win = tk.Toplevel(self.root)
        win.overrideredirect(True)
        win.configure(bg=P["border_glow"])
        rw, rh = 400, 320
        rx = max(0, self.root.winfo_x() + (self.root.winfo_width() - rw) // 2)
        ry = max(0, self.root.winfo_y() + 80)
        win.geometry(f"{rw}x{rh}+{rx}+{ry}")
        self._prepare_modal(win)

        inner = tk.Frame(win, bg=P["surface"], padx=2, pady=2)
        inner.pack(fill="both", expand=True, padx=1, pady=1)

        tk.Label(inner, text="\u2691 Bookmarks", font=F_SMALL,
                 fg=P["heading"], bg=P["surface"]).pack(padx=8, pady=(6, 4), anchor="w")

        bk_lb = tk.Listbox(inner, font=F_MONO, bg=P["panel"], fg=P["text"],
                            selectbackground=P["hover"], selectforeground=P["cyan"],
                            activestyle="none", bd=0, highlightthickness=0,
                            relief="flat", cursor="hand2")
        bk_lb.pack(fill="both", expand=True, padx=6, pady=(2, 4))

        # Flat list: (stem, line, label) for navigation
        bk_items: list[tuple[str, int, str]] = []
        current_stem = self.current_file.stem if self.current_file else ""

        # Current note bookmarks first
        if current_stem and current_stem in self._bookmarks:
            for ln, label in sorted(self._bookmarks[current_stem]):
                bk_items.append((current_stem, ln, label))
                bk_lb.insert("end", f"  \u2691 L{ln:>4}  {label}")

        # Other notes
        for stem, bmarks in sorted(self._bookmarks.items()):
            if stem == current_stem:
                continue
            for ln, label in sorted(bmarks):
                bk_items.append((stem, ln, label))
                bk_lb.insert("end", f"  [{stem}] L{ln:>4}  {label}")

        if not bk_items:
            bk_lb.insert("end", "  (no bookmarks yet)")

        def jump_to(*_):
            sel = bk_lb.curselection()
            if not sel or sel[0] >= len(bk_items):
                return
            stem, line_num, _ = bk_items[sel[0]]
            self._close_modal_window(win)
            # Open the note if different
            if not self.current_file or self.current_file.stem != stem:
                target = self.vault_path / f"{stem}.md"
                if not target.exists():
                    for fp in self._all_files:
                        if fp.stem == stem:
                            target = fp
                            break
                if target.exists():
                    self._show_editor()
                    self._open_file(target)
            self.editor.see(f"{line_num}.0")
            self.editor.mark_set("insert", f"{line_num}.0")
            self.editor.focus_set()

        def delete_selected(*_):
            sel = bk_lb.curselection()
            if not sel or sel[0] >= len(bk_items):
                return
            stem, line_num, _ = bk_items[sel[0]]
            if stem in self._bookmarks:
                self._bookmarks[stem] = [(ln, lb) for ln, lb in self._bookmarks[stem] if ln != line_num]
                if not self._bookmarks[stem]:
                    del self._bookmarks[stem]
            idx = sel[0]
            bk_items.pop(idx)
            bk_lb.delete(idx)

        bk_lb.bind("<Double-Button-1>", jump_to)

        btn_f = tk.Frame(inner, bg=P["surface"])
        btn_f.pack(fill="x", padx=6, pady=(0, 6))
        tk.Button(btn_f, text="\u2192 Jump", font=F_SMALL,
                  fg=P["emerald"], bg=P["panel"],
                  activebackground=P["hover"], bd=0,
                  command=jump_to, cursor="hand2").pack(side="left", padx=4)
        tk.Button(btn_f, text="\u2716 Remove", font=F_SMALL,
                  fg=P["rose"], bg=P["panel"],
                  activebackground=P["hover"], bd=0,
                  command=delete_selected, cursor="hand2").pack(side="left", padx=4)
        tk.Button(btn_f, text="Close", font=F_SMALL,
                  fg=P["text_dim"], bg=P["panel"],
                  activebackground=P["hover"], bd=0,
                  command=lambda: self._close_modal_window(win), cursor="hand2").pack(side="right", padx=4)

        win.bind("<Return>", jump_to)

    # ─── POMODORO FOCUS TIMER ────────────────────────────────────
    def _show_pomodoro(self):
        """Show pomodoro timer control panel."""
        win = tk.Toplevel(self.root)
        win.overrideredirect(True)
        win.configure(bg=P["border_glow"])
        rw, rh = 300, 280
        rx = max(0, self.root.winfo_x() + (self.root.winfo_width() - rw) // 2)
        ry = max(0, self.root.winfo_y() + 100)
        win.geometry(f"{rw}x{rh}+{rx}+{ry}")
        self._prepare_modal(win)

        inner = tk.Frame(win, bg=P["surface"], padx=2, pady=2)
        inner.pack(fill="both", expand=True, padx=1, pady=1)

        tk.Label(inner, text="\u25ce POMODORO TIMER", font=F_HEAD,
                 fg=P["heading"], bg=P["surface"]).pack(pady=(10, 4))

        # Timer display
        time_label = tk.Label(inner, text="25:00", font=(FONT, 28, "bold"),
                              fg=P["ember"], bg=P["surface"])
        time_label.pack(pady=4)

        mode_label = tk.Label(inner, text=f"mode: {self._pomo_mode}  |  sessions: {self._pomo_sessions}",
                              font=F_PIXEL, fg=P["text_dim"], bg=P["surface"])
        mode_label.pack(pady=(0, 8))

        # Progress bar canvas
        bar_c = tk.Canvas(inner, height=14, bg=P["panel"], highlightthickness=0)
        bar_c.pack(fill="x", padx=16, pady=4)

        def update_display():
            mins = self._pomo_remaining // 60
            secs = self._pomo_remaining % 60
            time_label.config(text=f"{mins:02d}:{secs:02d}")
            mode_label.config(text=f"mode: {self._pomo_mode}  |  sessions: {self._pomo_sessions}")
            total = self._pomo_work_secs if self._pomo_mode == "work" else self._pomo_break_secs
            bar_c.delete("all")
            bw = max(bar_c.winfo_width(), 200) - 8
            if total > 0:
                frac = (total - self._pomo_remaining) / total
                fill = int(bw * frac)
                bar_c.create_rectangle(4, 2, 4 + bw, 12, fill=P["panel"], outline=P["border"])
                color = P["emerald"] if self._pomo_mode == "work" else P["ice"]
                if fill > 0:
                    bar_c.create_rectangle(4, 2, 4 + fill, 12, fill=color, outline="")
                bar_c.create_rectangle(4 + fill - 2, 2, 4 + fill, 4,
                                       fill=P["text_bright"], outline="")

        if self._pomo_running:
            update_display()

        def start_work():
            self._pomo_mode = "work"
            self._pomo_remaining = self._pomo_work_secs
            self._pomo_running = True
            update_display()

        def start_break():
            self._pomo_mode = "break"
            self._pomo_remaining = self._pomo_break_secs
            self._pomo_running = True
            update_display()

        def pause_resume():
            self._pomo_running = not self._pomo_running
            update_display()

        def reset():
            self._pomo_running = False
            self._pomo_remaining = 0
            self._pomo_mode = "work"
            self.status_pomodoro.config(text="")
            update_display()

        btn_f = tk.Frame(inner, bg=P["surface"])
        btn_f.pack(fill="x", padx=12, pady=6)
        bs = dict(font=F_SMALL, bg=P["panel"], activebackground=P["hover"], bd=0, cursor="hand2")
        tk.Button(btn_f, text="\u25b6 Work 25m", fg=P["emerald"], command=start_work, **bs
                  ).pack(side="left", padx=3)
        tk.Button(btn_f, text="\u2615 Break 5m", fg=P["ice"], command=start_break, **bs
                  ).pack(side="left", padx=3)
        tk.Button(btn_f, text="\u23f8 Pause", fg=P["text"], command=pause_resume, **bs
                  ).pack(side="left", padx=3)
        tk.Button(btn_f, text="\u21ba Reset", fg=P["text_dim"], command=reset, **bs
                  ).pack(side="left", padx=3)

        tk.Button(inner, text="Close", font=F_SMALL,
                  fg=P["text_dim"], bg=P["panel"],
                  activebackground=P["hover"], bd=0,
                  command=lambda: self._close_modal_window(win), cursor="hand2").pack(pady=4)

    def _pomo_tick(self):
        """Called every second from _animate to update pomodoro."""
        if not self._pomo_running or self._pomo_remaining <= 0:
            return
        self._pomo_remaining -= 1
        mins = self._pomo_remaining // 60
        secs = self._pomo_remaining % 60
        icon = "\u25ce" if self._pomo_mode == "work" else "\u2615"
        color = P["ember"] if self._pomo_mode == "work" else P["ice"]
        self.status_pomodoro.config(text=f"{icon} {mins:02d}:{secs:02d}", fg=color)

        if self._pomo_remaining <= 0:
            self._pomo_running = False
            if self._pomo_mode == "work":
                self._pomo_sessions += 1
                self.status_pomodoro.config(text="\u2713 done! click for break", fg=P["emerald"])
                self.status_left.config(text=f"pomodoro #{self._pomo_sessions} complete!")
            else:
                self.status_pomodoro.config(text="\u2615 break over", fg=P["ice"])
                self.status_left.config(text="break over \u2014 ready for next session")

    # ─── NOTE DIFF VIEWER ────────────────────────────────────────
    def _show_diff_viewer(self):
        """Show diff between current note and a selected snapshot."""
        if not self.current_file:
            self.status_left.config(text="no note open")
            return
        stem = self.current_file.stem
        snaps = self._note_snapshots.get(stem, [])
        if not snaps:
            self.status_left.config(text="no snapshots to diff against")
            return

        current_content = self.editor.get("1.0", "end-1c")

        win = tk.Toplevel(self.root)
        win.title(f"Diff: {stem}")
        win.geometry("700x520")
        win.configure(bg=P["panel"])
        self._prepare_modal(win)

        tk.Label(win, text=f"\u25c8 DIFF VIEWER \u2014 {stem}", font=F_HEAD,
                 fg=P["heading"], bg=P["panel"]).pack(pady=(10, 4))

        # Snapshot selector
        sel_frame = tk.Frame(win, bg=P["panel"])
        sel_frame.pack(fill="x", padx=12, pady=4)
        tk.Label(sel_frame, text="Compare with:", font=F_SMALL,
                 fg=P["text_dim"], bg=P["panel"]).pack(side="left")
        snap_var = tk.StringVar()
        snap_names = [ts for ts, _ in snaps]
        snap_var.set(snap_names[-1] if snap_names else "")
        snap_menu = tk.OptionMenu(sel_frame, snap_var, *snap_names)
        snap_menu.config(font=F_PIXEL, bg=P["surface"], fg=P["text"],
                         activebackground=P["hover"], bd=0, highlightthickness=0)
        snap_menu.pack(side="left", padx=8)

        # Diff display
        diff_text = tk.Text(win, font=(FONT, 10), bg=P["surface"], fg=P["text"],
                            bd=0, padx=12, pady=8, wrap="word",
                            highlightthickness=0, relief="flat")
        diff_text.pack(fill="both", expand=True, padx=12, pady=4)
        diff_text.tag_configure("added", foreground=P["emerald"], background="#0A1A10")
        diff_text.tag_configure("removed", foreground=P["rose"], background="#1A0A10")
        diff_text.tag_configure("context", foreground=P["text_dim"])
        diff_text.tag_configure("header", foreground=P["cyan"], font=(FONT, 10, "bold"))

        def compute_diff(*_):
            diff_text.config(state="normal")
            diff_text.delete("1.0", "end")
            ts = snap_var.get()
            snap_content = ""
            for t, c in snaps:
                if t == ts:
                    snap_content = c
                    break
            old_lines = snap_content.split("\n")
            new_lines = current_content.split("\n")

            diff_text.insert("end", f"  Snapshot: {ts}\n", "header")
            diff_text.insert("end", f"  Current edit vs snapshot\n\n", "context")

            # Simple line-by-line diff
            max_len = max(len(old_lines), len(new_lines))
            for i in range(max_len):
                old = old_lines[i] if i < len(old_lines) else None
                new = new_lines[i] if i < len(new_lines) else None
                if old == new:
                    diff_text.insert("end", f"  {old}\n", "context")
                else:
                    if old is not None:
                        diff_text.insert("end", f"- {old}\n", "removed")
                    if new is not None:
                        diff_text.insert("end", f"+ {new}\n", "added")
            diff_text.config(state="disabled")

        snap_var.trace_add("write", compute_diff)
        compute_diff()

        tk.Button(win, text="Close", font=F_SMALL,
                  fg=P["text_dim"], bg=P["surface"],
                  activebackground=P["hover"], bd=0,
                  command=lambda: self._close_modal_window(win), cursor="hand2").pack(pady=8)

    # ─── STICKY NOTES BOARD ──────────────────────────────────────
    def _show_sticky_board(self):
        """Floating sticky notes board for quick ideas."""
        win = tk.Toplevel(self.root)
        win.title("Sticky Board")
        win.geometry("600x440")
        win.configure(bg=P["obsidian"])
        win.transient(self.root)

        # Store stickies as list of dicts in memory
        if not hasattr(self, "_stickies"):
            self._stickies: list[dict] = []

        sticky_colors = [
            ("#1A2A2A", P["cyan"]),      # dark teal
            ("#1A1A2A", P["amethyst"]),   # dark purple
            ("#1A2A1A", P["emerald"]),    # dark green
            ("#2A1A1A", P["ember"]),      # dark red
            ("#1A1A20", P["ice"]),        # dark blue
            ("#2A1A2A", P["rose"]),       # dark pink
        ]

        board_canvas = tk.Canvas(win, bg=P["obsidian"], highlightthickness=0)
        board_canvas.pack(fill="both", expand=True)

        # Header
        tk.Label(win, text="\u25a0 STICKY BOARD", font=F_HEAD,
                 fg=P["heading"], bg=P["obsidian"]).place(x=10, y=6)

        def draw_stickies():
            board_canvas.delete("all")
            # Grid pattern
            cw = max(board_canvas.winfo_width(), 500)
            ch = max(board_canvas.winfo_height(), 350)
            for gx in range(0, cw, 32):
                board_canvas.create_line(gx, 0, gx, ch, fill=P["border"], dash=(1, 12))

            for i, st in enumerate(self._stickies):
                x, y = st.get("x", 40 + (i % 4) * 140), st.get("y", 40 + (i // 4) * 120)
                sw, sh = 130, 100
                bg_c, fg_c = sticky_colors[i % len(sticky_colors)]

                # Shadow
                board_canvas.create_rectangle(x + 3, y + 3, x + sw + 3, y + sh + 3,
                                              fill=P["void"], outline="")
                # Card
                board_canvas.create_rectangle(x, y, x + sw, y + sh,
                                              fill=bg_c, outline=fg_c, width=1)
                # Pixel corners
                for cx, cy in [(x, y), (x+sw-3, y), (x, y+sh-3), (x+sw-3, y+sh-3)]:
                    board_canvas.create_rectangle(cx, cy, cx+3, cy+3, fill=fg_c, outline="")
                # Pin dot
                board_canvas.create_oval(x + sw // 2 - 3, y + 2, x + sw // 2 + 3, y + 8,
                                         fill=fg_c, outline="")

                # Text
                text = st.get("text", "")
                lines = text.split("\n")[:5]
                for li, line in enumerate(lines):
                    disp = line[:18] + ("\u2026" if len(line) > 18 else "")
                    board_canvas.create_text(x + 8, y + 18 + li * 14, text=disp,
                                             font=F_PIXEL, fill=fg_c, anchor="nw")

        def add_sticky():
            text = sticky_entry.get("1.0", "end-1c").strip()
            if not text:
                return
            idx = len(self._stickies)
            self._stickies.append({
                "text": text,
                "x": 20 + (idx % 4) * 140,
                "y": 40 + (idx // 4) * 120,
            })
            sticky_entry.delete("1.0", "end")
            draw_stickies()

        def clear_stickies():
            self._stickies.clear()
            draw_stickies()

        # Input area
        input_f = tk.Frame(win, bg=P["surface"])
        input_f.pack(fill="x", side="bottom", padx=8, pady=6)
        sticky_entry = tk.Text(input_f, font=F_SMALL, bg=P["panel"], fg=P["text"],
                               insertbackground=P["cyan"], bd=0, height=2,
                               highlightthickness=1, highlightcolor=P["cyan"],
                               highlightbackground=P["border"], wrap="word")
        sticky_entry.pack(side="left", fill="x", expand=True, padx=(4, 4), pady=4)

        tk.Button(input_f, text="+ Add", font=F_SMALL,
                  fg=P["emerald"], bg=P["panel"],
                  activebackground=P["hover"], bd=0,
                  command=add_sticky, cursor="hand2").pack(side="left", padx=4, pady=4)
        tk.Button(input_f, text="Clear", font=F_SMALL,
                  fg=P["rose"], bg=P["panel"],
                  activebackground=P["hover"], bd=0,
                  command=clear_stickies, cursor="hand2").pack(side="left", padx=4, pady=4)

        win.after(100, draw_stickies)

    # ─── RANDOM NOTE OPENER ──────────────────────────────────────
    def _open_random_note(self):
        """Open a random note from the vault for serendipitous discovery."""
        if not self._all_files:
            self.status_left.config(text="vault is empty")
            return
        fp = random.choice(self._all_files)
        self._show_editor()
        self._open_file(fp)
        self.status_left.config(text=f"\U0001f3b2 random pick: {fp.stem}")

    # ─── WORD FREQUENCY CLOUD ────────────────────────────────────
    def _show_word_cloud(self):
        """Show a visual word frequency cloud for the current note."""
        if not self.current_file:
            self.status_left.config(text="no note open")
            return
        content = self.editor.get("1.0", "end-1c")
        # Count words, filter short/common ones
        stop = {"the", "and", "for", "are", "but", "not", "you", "all",
                "can", "had", "her", "was", "one", "our", "out", "has",
                "its", "let", "may", "who", "how", "did", "get", "him",
                "his", "she", "this", "that", "with", "have", "from",
                "they", "been", "some", "what", "when", "will", "more",
                "also", "than", "them", "into", "each", "make", "just",
                "about", "very", "your", "were", "would", "there", "their"}
        words: dict[str, int] = {}
        for w in re.findall(r"[a-zA-Z\u00C0-\u017F]+", content.lower()):
            if len(w) >= 3 and w not in stop:
                words[w] = words.get(w, 0) + 1
        if not words:
            self.status_left.config(text="not enough words to analyze")
            return
        # Top 40
        sorted_w = sorted(words.items(), key=lambda x: x[1], reverse=True)[:40]
        max_count = sorted_w[0][1] if sorted_w else 1

        win = tk.Toplevel(self.root)
        win.title(f"Word Cloud: {self.current_file.stem}")
        win.geometry("560x400")
        win.configure(bg=P["obsidian"])
        win.transient(self.root)

        tk.Label(win, text="\u2601 WORD FREQUENCY CLOUD", font=F_HEAD,
                 fg=P["heading"], bg=P["obsidian"]).pack(pady=(10, 4))

        cloud_canvas = tk.Canvas(win, bg=P["void"], highlightthickness=0)
        cloud_canvas.pack(fill="both", expand=True, padx=12, pady=8)

        cloud_colors = [P["cyan"], P["amethyst"], P["emerald"], P["ice"],
                        P["ember"], P["rose"], P["teal"], P["text"]]

        def draw_cloud(event=None):
            cloud_canvas.delete("all")
            cw = max(cloud_canvas.winfo_width(), 400)
            ch = max(cloud_canvas.winfo_height(), 260)
            # Grid pattern
            for gx in range(0, cw, 40):
                cloud_canvas.create_line(gx, 0, gx, ch, fill=P["border"], dash=(1, 16))
            # Place words in a spiral-like layout
            cx, cy = cw // 2, ch // 2
            placed: list[tuple[int, int, int, int]] = []
            for idx, (word, count) in enumerate(sorted_w):
                frac = count / max_count
                font_size = max(8, int(8 + frac * 22))
                color = cloud_colors[idx % len(cloud_colors)]
                # Spiral placement
                angle = idx * 2.4
                radius = 20 + idx * 8
                tx = int(cx + radius * math.cos(angle))
                ty = int(cy + radius * math.sin(angle) * 0.6)
                # Clamp to canvas
                tx = max(40, min(cw - 40, tx))
                ty = max(16, min(ch - 16, ty))
                cloud_canvas.create_text(tx, ty, text=word, font=(FONT, font_size),
                                         fill=color, anchor="center")
                # Count badge
                if count > 1:
                    cloud_canvas.create_text(tx, ty + font_size // 2 + 6,
                                             text=str(count), font=F_PIXEL,
                                             fill=P["text_dim"], anchor="center")

        cloud_canvas.bind("<Configure>", draw_cloud)
        win.after(80, draw_cloud)
        win.bind("<Escape>", lambda e: win.destroy())

    # ─── NOTE TEMPLATES MANAGER ──────────────────────────────────
    def _show_templates(self):
        """Manage and apply note templates."""
        tpl_dir = self.vault_path / ".templates"
        tpl_dir.mkdir(exist_ok=True)

        win = tk.Toplevel(self.root)
        win.title("Note Templates")
        win.geometry("480x420")
        win.configure(bg=P["panel"])
        self._prepare_modal(win)

        tk.Label(win, text="\u2726 NOTE TEMPLATES", font=F_HEAD,
                 fg=P["heading"], bg=P["panel"]).pack(pady=(10, 6))

        # Template list
        list_frame = tk.Frame(win, bg=P["surface"])
        list_frame.pack(fill="both", expand=True, padx=12, pady=4)

        tpl_lb = tk.Listbox(list_frame, font=F_MONO, bg=P["surface"], fg=P["text"],
                            selectbackground=P["hover"], selectforeground=P["cyan"],
                            activestyle="none", bd=0, highlightthickness=0,
                            relief="flat", cursor="hand2")
        tpl_lb.pack(fill="both", expand=True, padx=4, pady=4)

        def refresh_list():
            tpl_lb.delete(0, "end")
            for f in sorted(tpl_dir.glob("*.md")):
                tpl_lb.insert("end", f"  \u2726 {f.stem}")

        refresh_list()

        # Buttons
        btn_f = tk.Frame(win, bg=P["panel"])
        btn_f.pack(fill="x", padx=12, pady=6)
        bs = dict(font=F_SMALL, bg=P["surface"], activebackground=P["hover"],
                  bd=0, cursor="hand2")

        def save_as_template():
            if not self.current_file:
                self.status_left.config(text="no note open")
                return
            content = self.editor.get("1.0", "end-1c")
            name = self.current_file.stem
            try:
                (tpl_dir / f"{name}.md").write_text(content, encoding="utf-8")
            except OSError as e:
                messagebox.showerror("Error", f"Cannot save template:\n{e}")
                return
            refresh_list()
            self.status_left.config(text=f"template saved: {name}")

        def apply_template():
            sel = tpl_lb.curselection()
            if not sel:
                return
            entry_text = tpl_lb.get(sel[0]).strip().replace("\u2726 ", "")
            tpl_path = tpl_dir / f"{entry_text}.md"
            if tpl_path.exists():
                content = tpl_path.read_text(encoding="utf-8")
                self.editor.insert("end", "\n" + content)
                self.modified = True
                self.status_left.config(text=f"template applied: {entry_text}")

        def delete_template():
            sel = tpl_lb.curselection()
            if not sel:
                return
            entry_text = tpl_lb.get(sel[0]).strip().replace("\u2726 ", "")
            tpl_path = tpl_dir / f"{entry_text}.md"
            if tpl_path.exists():
                try:
                    tpl_path.unlink()
                except OSError as e:
                    messagebox.showerror("Error", f"Cannot delete template:\n{e}")
                    return
                refresh_list()
                self.status_left.config(text=f"template deleted: {entry_text}")

        def new_from_template():
            sel = tpl_lb.curselection()
            if not sel:
                return
            entry_text = tpl_lb.get(sel[0]).strip().replace("\u2726 ", "")
            tpl_path = tpl_dir / f"{entry_text}.md"
            if tpl_path.exists():
                content = tpl_path.read_text(encoding="utf-8")
                # Find unique name
                base = f"{entry_text} (copy)"
                new_path = self.vault_path / f"{base}.md"
                counter = 1
                while new_path.exists():
                    counter += 1
                    new_path = self.vault_path / f"{entry_text} (copy {counter}).md"
                try:
                    new_path.write_text(content, encoding="utf-8")
                except OSError as e:
                    messagebox.showerror("Error", f"Cannot create note:\n{e}")
                    return
                self._refresh_file_tree()
                self._open_file(new_path)
                self.status_left.config(text=f"new note from template: {new_path.stem}")
                win.destroy()

        tk.Button(btn_f, text="Save Current as Template", fg=P["emerald"],
                  command=save_as_template, **bs).pack(side="left", padx=3)
        tk.Button(btn_f, text="Apply to Note", fg=P["cyan"],
                  command=apply_template, **bs).pack(side="left", padx=3)
        tk.Button(btn_f, text="New Note", fg=P["ice"],
                  command=new_from_template, **bs).pack(side="left", padx=3)
        tk.Button(btn_f, text="Delete", fg=P["rose"],
                  command=delete_template, **bs).pack(side="left", padx=3)

        tk.Button(win, text="Close", font=F_SMALL,
                  fg=P["text_dim"], bg=P["surface"],
                  activebackground=P["hover"], bd=0,
                  command=lambda: self._close_modal_window(win), cursor="hand2").pack(pady=6)

    # ─── VAULT CHANGELOG ─────────────────────────────────────────
    def _show_vault_changelog(self):
        """Show a chronological activity log of vault file changes."""
        win = tk.Toplevel(self.root)
        win.title("Vault Changelog")
        win.geometry("520x440")
        win.configure(bg=P["panel"])
        win.transient(self.root)

        tk.Label(win, text="\u2630 VAULT CHANGELOG", font=F_HEAD,
                 fg=P["heading"], bg=P["panel"]).pack(pady=(10, 4))

        log_text = tk.Text(win, font=(FONT, 10), bg=P["surface"], fg=P["text"],
                           bd=0, padx=12, pady=8, wrap="word",
                           highlightthickness=0, relief="flat")
        log_text.pack(fill="both", expand=True, padx=12, pady=4)
        log_text.tag_configure("date", foreground=P["cyan"], font=(FONT, 10, "bold"))
        log_text.tag_configure("file", foreground=P["emerald"])
        log_text.tag_configure("size", foreground=P["text_dim"])
        log_text.tag_configure("header", foreground=P["amethyst"], font=(FONT, 10, "bold"))

        import os
        entries: list[tuple[float, str, int]] = []
        for fp in self._all_files:
            try:
                stat = fp.stat()
                entries.append((stat.st_mtime, fp.stem, int(stat.st_size)))
            except OSError:
                pass

        # Sort by most recent
        entries.sort(key=lambda x: x[0], reverse=True)

        log_text.insert("end", "  Recent vault activity\n\n", "header")
        from datetime import datetime as dt
        current_day = ""
        for mtime, stem, size in entries:
            day = dt.fromtimestamp(mtime).strftime("%Y-%m-%d")
            time_str = dt.fromtimestamp(mtime).strftime("%H:%M")
            if day != current_day:
                current_day = day
                log_text.insert("end", f"\n  \u2500\u2500 {day} \u2500\u2500\n", "date")
            size_kb = size / 1024
            log_text.insert("end", f"  {time_str}  ", "size")
            log_text.insert("end", f"{stem}", "file")
            log_text.insert("end", f"  ({size_kb:.1f} KB)\n", "size")

        log_text.config(state="disabled")

        tk.Button(win, text="Close", font=F_SMALL,
                  fg=P["text_dim"], bg=P["surface"],
                  activebackground=P["hover"], bd=0,
                  command=win.destroy, cursor="hand2").pack(pady=8)
        win.bind("<Escape>", lambda e: win.destroy())

    # ─── OUTLINE REORDER ─────────────────────────────────────────
    def _reorder_heading_up(self):
        """Move the selected heading section up in the document."""
        self._move_heading(-1)

    def _reorder_heading_down(self):
        """Move the selected heading section down in the document."""
        self._move_heading(1)

    def _move_heading(self, direction: int):
        """Move a heading section up (-1) or down (+1) within the note."""
        if not self.current_file:
            return
        content = self.editor.get("1.0", "end-1c")
        lines = content.split("\n")

        # Find all heading positions
        headings: list[tuple[int, int, str]] = []  # (line_idx, level, text)
        for i, line in enumerate(lines):
            m = re.match(r"^(#{1,6})\s+(.+)", line)
            if m:
                headings.append((i, len(m.group(1)), m.group(2)))

        if not headings:
            self.status_left.config(text="no headings found")
            return

        # Determine which heading is selected in outline
        sel = self.outline_listbox.curselection()
        if not sel:
            self.status_left.config(text="select heading in outline first")
            return
        sel_idx = sel[0]
        if sel_idx >= len(headings):
            return

        target_heading_idx = sel_idx
        swap_heading_idx = target_heading_idx + direction

        if swap_heading_idx < 0 or swap_heading_idx >= len(headings):
            return

        # Determine section boundaries
        def section_range(h_idx: int) -> tuple[int, int]:
            start = headings[h_idx][0]
            if h_idx + 1 < len(headings):
                end = headings[h_idx + 1][0]
            else:
                end = len(lines)
            return start, end

        r1 = section_range(target_heading_idx)
        r2 = section_range(swap_heading_idx)

        section_a = lines[r1[0]:r1[1]]
        section_b = lines[r2[0]:r2[1]]

        # Swap
        if direction == -1:  # move up
            new_lines = lines[:r2[0]] + section_a + section_b + lines[r1[1]:]
        else:  # move down
            new_lines = lines[:r1[0]] + section_b + section_a + lines[r2[1]:]

        self.editor.delete("1.0", "end")
        self.editor.insert("1.0", "\n".join(new_lines))
        self.modified = True
        self._update_outline()
        # Re-select the moved heading
        new_sel = swap_heading_idx if direction == -1 else swap_heading_idx
        if 0 <= new_sel < self.outline_listbox.size():
            self.outline_listbox.selection_clear(0, "end")
            self.outline_listbox.selection_set(new_sel)
        self.status_left.config(text=f"heading moved {'up' if direction == -1 else 'down'}")

    # ─── ANIMATION LOOP ─────────────────────────────────────────
    def _get_node_connections(self):
        """Return list of (src_id, dst_id) for pipeline edges."""
        nodes = PipelineSimulator.NODES
        edges = []
        for i in range(len(nodes) - 1):
            edges.append((nodes[i][0], nodes[i + 1][0]))
        return edges

    def _animate(self):
        self._anim_tick += 1

        # Pomodoro tick (~once per second, every 26th frame at 38ms)
        if self._anim_tick % 26 == 0:
            self._pomo_tick()

        # ── Graph ambient animation ──
        if self.view_mode == "graph":
            self._graph_anim_phase += 0.12
            # Emit flow particles along graph edges periodically
            if self._anim_tick % 16 == 0 and self._graph_node_positions:
                for src, tgts in self.notes_graph.items():
                    if src not in self._graph_node_positions:
                        continue
                    for tgt in tgts:
                        if tgt not in self._graph_node_positions:
                            continue
                        if random.random() > 0.15:
                            continue
                        sx, sy, _ = self._graph_node_positions[src]
                        tx, ty, _ = self._graph_node_positions[tgt]
                        color = random.choice([P["cyan_dim"], P["amethyst_dim"], P["ice"]])
                        self._graph_flow_particles.append(
                            FlowParticle(sx, sy, tx, ty, color, speed=0.03))
            # Update graph flow particles
            self._graph_flow_particles = [fp for fp in self._graph_flow_particles if fp.update()]
            if len(self._graph_flow_particles) > 80:
                self._graph_flow_particles = self._graph_flow_particles[-80:]
            # Redraw flow particles on canvas (lightweight — only tagged items)
            self.graph_canvas.delete("graph_flow")
            for fp in self._graph_flow_particles:
                fp.draw_on(self.graph_canvas, "graph_flow")

        # Pipeline simulation steps
        if self.pipeline.is_running:
            still_running = self.pipeline.step()
            if self.view_mode == "schema":
                _now_s = time.time()
                if _now_s - self._last_schema_draw_t > 0.08:
                    self._last_schema_draw_t = _now_s
                    self._draw_schema()
                self._update_schema_log()
            if self.view_mode == "graph":
                self._graph_ai_tick()
                _now = time.time()
                if _now - self._last_graph_draw_t > 0.45:
                    self._last_graph_draw_t = _now
                    self._draw_graph()
            if not still_running:
                self.schema_status.config(text="scenario complete", fg=P["cyan"])
                if self.view_mode == "schema":
                    self._update_schema_log()
                # Clear graph AI state when pipeline finishes
                self._graph_ai_stage = "COMPLETE"
                self._graph_ai_stage_color = P["ok"]
                self.graph_ai_status_lbl.config(text="complete", fg=P["ok"])
                if self.view_mode == "graph":
                    self._draw_graph()

        # Graph AI fade-out after pipeline completion
        if not self.pipeline.is_running and self._graph_ai_active_nodes and self.view_mode == "graph":
            # Gradually decay all active nodes
            to_remove = []
            for node_stem, info in self._graph_ai_active_nodes.items():
                info["intensity"] -= 0.04
                if info["intensity"] <= 0:
                    to_remove.append(node_stem)
            for k in to_remove:
                del self._graph_ai_active_nodes[k]
            # Also decay scan waves and trails
            self._graph_ai_scan_waves = [
                w for w in self._graph_ai_scan_waves if time.time() - w["t_start"] < 1.2
            ]
            self._graph_ai_trails = [t for t in self._graph_ai_trails if t["progress"] < 1.0]
            for trail in self._graph_ai_trails:
                trail["progress"] += 0.05
            self._draw_graph()
            # Clear stage label when fully faded
            if not self._graph_ai_active_nodes:
                self._graph_ai_stage = ""

        # Schema particles (emit from active nodes)
        if self.view_mode == "schema" and self.pipeline.is_running:
            for nid, state in self.pipeline.node_states.items():
                if state == "active" and nid in self._schema_node_rects:
                    rx, ry, rw, rh = self._schema_node_rects[nid]
                    self.particles_schema.emit(
                        rx + random.randint(0, rw),
                        ry + random.randint(0, rh)
                    )
        # Ambient idle particles — sparse floating motes when pipeline idle
        if self.view_mode == "schema" and not self.pipeline.is_running:
            if self._anim_tick % 45 == 0:
                try:
                    sw = max(self.schema_canvas.winfo_width(), 400)
                    sh = max(self.schema_canvas.winfo_height(), 300)
                    self.particles_schema.emit(
                        random.randint(40, sw - 40),
                        random.randint(40, sh - 40), count=1)
                except tk.TclError:
                    pass
        self.particles_schema.update()
        if self.view_mode == "schema":
            self.schema_canvas.delete("particle")
            self.particles_schema.draw(self.schema_canvas)

        # Data flow particles between pipeline nodes
        if self.view_mode == "schema" and self.pipeline.is_running:
            if self._anim_tick % 10 == 0:
                for src_id, dst_id in self._get_node_connections():
                    src_state = self.pipeline.node_states.get(src_id, "idle")
                    dst_state = self.pipeline.node_states.get(dst_id, "idle")
                    if src_state == "done" and dst_state in ("active", "done"):
                        if src_id in self._schema_positions and dst_id in self._schema_positions:
                            sx, sy = self._schema_positions[src_id]
                            ex, ey = self._schema_positions[dst_id]
                            node_colors = {n[0]: P[n[2]] for n in PipelineSimulator.NODES}
                            color = node_colors.get(src_id, P["cyan"])
                            self._flow_particles.append(FlowParticle(sx, sy, ex, ey, color))

        # Update and draw flow particles
        self._flow_particles = [fp for fp in self._flow_particles if fp.update()]
        if len(self._flow_particles) > 100:
            self._flow_particles = self._flow_particles[-100:]
        if self.view_mode == "schema":
            self.schema_canvas.delete("flow")
            for fp in self._flow_particles:
                fp.draw(self.schema_canvas)

        # Hive AI processing + redraw
        if self._ai_processing_task:
            self._hive_process_tick()
        # Pipeline → Hive neuron mapping: light up neurons based on real pipeline stages
        if self.pipeline.is_running and self._ai_hive_initialized:
            self._hive_pipeline_sync()
        if self.view_mode == "hive":
            # Throttle idle hive redraws to every 3rd frame (~9 FPS idle)
            is_active = self._ai_processing_task or self.pipeline.is_running
            _now_h = time.time()
            _hive_interval = 0.04 if is_active else 0.12
            if _now_h - self._last_hive_draw_t > _hive_interval:
                self._last_hive_draw_t = _now_h
                self._hive_draw()
            # Slowly decay neuron activations (slower in idle for sustained glow)
            is_active = self._ai_processing_task or self.pipeline.is_running
            decay = 0.985 if not is_active else 0.97
            for neuron in self._ai_neurons:
                neuron["activation"] *= decay
            # Ambient idle animation — rich, alive, always-on effects
            if not is_active and self._ai_hive_initialized:
                self._hive_ambient_tick += 1
                tick = self._hive_ambient_tick
                n_count = len(self._ai_neurons)

                # ── Scanning sweep: wave of activation rolls across layers ──
                if tick % 3 == 0:
                    wave_phase = math.sin(time.time() * 0.4) * 0.5 + 0.5  # 0-1 oscillating
                    for neuron in self._ai_neurons:
                        layer_map = {"input": 0, "analyze": 0.33, "process": 0.66, "output": 1.0}
                        layer_pos = layer_map.get(neuron["layer"], 0.5)
                        dist = abs(layer_pos - wave_phase)
                        if dist < 0.2:
                            boost = (0.2 - dist) / 0.2 * 0.35
                            neuron["activation"] = max(neuron["activation"], boost)

                # ── Breathing: randomly light up neurons ──
                if tick % 35 == 0:
                    for _ in range(random.randint(2, 5)):
                        idx = random.randint(0, n_count - 1)
                        self._ai_neurons[idx]["activation"] = max(
                            self._ai_neurons[idx]["activation"],
                            random.uniform(0.25, 0.60)
                        )

                # ── Frequent ambient pulses along synapses ──
                if tick % 30 == 0 and self._ai_synapses:
                    for _ in range(random.randint(2, 4)):
                        syn = random.choice(self._ai_synapses)
                        self._ai_pulses.append({
                            "src": syn["src"], "dst": syn["dst"],
                            "t": 0.0, "speed": random.uniform(0.012, 0.030),
                            "color": random.choice([P["cyan_dim"], P["amethyst_dim"],
                                                   P["border_glow"], P["ice"],
                                                   P["emerald"]]),
                        })

                # ── Idle thought bubbles — system "thinking" ──
                if tick % 200 == 0:
                    idle_thoughts = [
                        "monitoring vault...", "indexing links",
                        "scanning patterns", "analyzing structure",
                        "graph updated", "neural standby",
                        "knowledge sync", "awaiting input",
                        "link analysis", "pattern match",
                        "vault integrity OK", "ready for tasks",
                        "deep learning idle", "semantic index",
                    ]
                    self._ai_add_thought(random.choice(idle_thoughts))

                # ── Chain reaction: high-activation neurons fire along synapses ──
                if tick % 15 == 0 and self._ai_synapses:
                    for syn in self._ai_synapses:
                        si = syn["src"]
                        if si < n_count and self._ai_neurons[si]["activation"] > 0.4:
                            if random.random() < 0.12:
                                di = syn["dst"]
                                if di < n_count:
                                    self._ai_neurons[di]["activation"] = max(
                                        self._ai_neurons[di]["activation"],
                                        self._ai_neurons[si]["activation"] * 0.5
                                    )
                                    self._ai_pulses.append({
                                        "src": si, "dst": di,
                                        "t": 0.0, "speed": random.uniform(0.02, 0.05),
                                        "color": self._ai_neurons[si]["color"],
                                    })

        if not self._closing:
            self.root.after(38, self._animate)


# ═══════════════════════════════════════════════════════════════════
def main():
    root = tk.Tk()
    try:
        import ctypes
        root.update_idletasks()
        hwnd = ctypes.windll.user32.GetParent(root.winfo_id())
        ctypes.windll.dwmapi.DwmSetWindowAttribute(
            hwnd, 20, ctypes.byref(ctypes.c_int(1)), ctypes.sizeof(ctypes.c_int))
    except Exception:
        pass

    app = ShumilekHive(root)

    def _on_close():
        app._shutdown()

    root.protocol("WM_DELETE_WINDOW", _on_close)
    root.mainloop()


if __name__ == "__main__":
    main()
