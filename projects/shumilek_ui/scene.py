from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PixelNode:
    key: str
    title: str
    subtitle: str
    kind: str
    x: int
    y: int
    width: int
    height: int


@dataclass(frozen=True)
class PixelEdge:
    start: str
    end: str
    color: str


@dataclass(frozen=True)
class SidebarBlock:
    title: str
    items: tuple[str, ...]
    accent: str


PALETTE = {
    # Deep obsidian base
    "night_sky": "#0D0E18",
    "sky_glow": "#13142A",
    "fog": "#1A1B30",
    # Warm accents
    "moon": "#F0D890",
    "pine": "#1E4A14",
    "moss": "#3A6A22",
    "fern": "#5A8A30",
    "river": "#3A6A8F",
    "river_shadow": "#1A4A6F",
    "sand": "#7A6330",
    # Dark wooden panels
    "panel": "#151210",
    "panel_edge": "#4A3820",
    "panel_soft": "#1C1814",
    # Light-on-dark text
    "text": "#D8CCA8",
    "muted": "#6A5E4A",
    # Neon game accents
    "gold": "#E8B820",
    "leaf": "#44CC44",
    "rose": "#E85050",
    "cyan": "#40D0F0",
    "lavender": "#B088E8",
    # Glow variants
    "glow_cyan": "#1A3040",
    "glow_gold": "#302818",
    "glow_leaf": "#1A2A1A",
    "glow_rose": "#2A1818",
}


def build_sidebar_blocks() -> list[SidebarBlock]:
    return [
        SidebarBlock(
            title="Lesni vrstvy",
            items=("Koruny stromu", "Potok kontextu", "Mlhavy fokus"),
            accent=PALETTE["leaf"],
        ),
        SidebarBlock(
            title="Shumilkova mysl",
            items=("Rozum", "Svedomi", "Guardian"),
            accent=PALETTE["cyan"],
        ),
        SidebarBlock(
            title="Pracovni stezky",
            items=("Chat habitat", "Souborova stezka", "Tool orchestrator"),
            accent=PALETTE["gold"],
        ),
    ]


def build_workspace_nodes() -> list[PixelNode]:
    return [
        PixelNode("entry", "Lesni brana", "Vstup do session", "gold", 140, 90, 220, 72),
        PixelNode("memory", "Mechova pamet", "Dlouhodoby kontext", "green", 110, 240, 230, 80),
        PixelNode("flow", "Reka odpovedi", "Proud chatu a akci", "blue", 410, 180, 250, 88),
        PixelNode("tools", "Drevene nastroje", "Editace, diffy, terminal", "violet", 420, 340, 248, 80),
        PixelNode("guardian", "Svetluskovy guardian", "Kvalita a validace", "rose", 730, 150, 250, 80),
        PixelNode("workspace", "Korunovy workspace", "Mapa bloku a projektu", "green", 720, 320, 276, 88),
        PixelNode("pixel", "PixelLab paseka", "Budouci asset pipeline", "blue", 1010, 235, 250, 88),
        PixelNode("output", "Odpoved", "Finalni odpoved uzivateli", "gold", 1200, 235, 200, 72),
    ]


def build_workspace_edges() -> list[PixelEdge]:
    return [
        PixelEdge("entry", "memory", PALETTE["leaf"]),
        PixelEdge("entry", "flow", PALETTE["gold"]),
        PixelEdge("memory", "flow", PALETTE["cyan"]),
        PixelEdge("flow", "tools", PALETTE["lavender"]),
        PixelEdge("flow", "guardian", PALETTE["rose"]),
        PixelEdge("guardian", "workspace", PALETTE["leaf"]),
        PixelEdge("workspace", "pixel", PALETTE["cyan"]),
        PixelEdge("tools", "workspace", PALETTE["gold"]),
    ]


def find_node(node_key: str) -> PixelNode:
    for node in build_workspace_nodes():
        if node.key == node_key:
            return node
    raise KeyError(node_key)