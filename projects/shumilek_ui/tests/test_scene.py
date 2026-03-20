import unittest

from projects.shumilek_ui.scene import (
    PALETTE,
    PixelEdge,
    PixelNode,
    SidebarBlock,
    build_sidebar_blocks,
    build_workspace_edges,
    build_workspace_nodes,
    find_node,
)


class SceneModelTests(unittest.TestCase):
    def test_workspace_has_enough_nodes(self) -> None:
        nodes = build_workspace_nodes()
        self.assertGreaterEqual(len(nodes), 6)

    def test_edges_reference_existing_nodes(self) -> None:
        node_keys = {node.key for node in build_workspace_nodes()}
        for edge in build_workspace_edges():
            self.assertIn(edge.start, node_keys)
            self.assertIn(edge.end, node_keys)

    def test_sidebar_blocks_have_items(self) -> None:
        blocks = build_sidebar_blocks()
        self.assertGreaterEqual(len(blocks), 3)
        self.assertTrue(all(block.items for block in blocks))

    def test_find_node_returns_workspace_block(self) -> None:
        node = find_node("workspace")
        self.assertEqual(node.title, "Korunovy workspace")


class FindNodeTests(unittest.TestCase):
    """Tests for find_node() lookup behavior."""

    def test_find_node_raises_keyerror_for_invalid_key(self) -> None:
        with self.assertRaises(KeyError):
            find_node("nonexistent_node_xyz")

    def test_find_all_nodes_by_key(self) -> None:
        """Every node returned by build_workspace_nodes can be found via find_node."""
        for node in build_workspace_nodes():
            found = find_node(node.key)
            self.assertEqual(found, node)

    def test_find_node_returns_correct_type(self) -> None:
        node = find_node("entry")
        self.assertIsInstance(node, PixelNode)

    def test_find_node_empty_string_raises(self) -> None:
        with self.assertRaises(KeyError):
            find_node("")


class NodeInvariantTests(unittest.TestCase):
    """Tests for workspace node data invariants."""

    def test_node_keys_are_unique(self) -> None:
        nodes = build_workspace_nodes()
        keys = [n.key for n in nodes]
        self.assertEqual(len(keys), len(set(keys)))

    def test_node_coordinates_are_non_negative(self) -> None:
        for node in build_workspace_nodes():
            self.assertGreaterEqual(node.x, 0, f"Node {node.key} has negative x")
            self.assertGreaterEqual(node.y, 0, f"Node {node.key} has negative y")

    def test_node_dimensions_are_positive(self) -> None:
        for node in build_workspace_nodes():
            self.assertGreater(node.width, 0, f"Node {node.key} has non-positive width")
            self.assertGreater(node.height, 0, f"Node {node.key} has non-positive height")

    def test_node_keys_are_non_empty_strings(self) -> None:
        for node in build_workspace_nodes():
            self.assertIsInstance(node.key, str)
            self.assertTrue(node.key.strip(), f"Node has empty key")

    def test_node_titles_are_non_empty(self) -> None:
        for node in build_workspace_nodes():
            self.assertTrue(node.title.strip(), f"Node {node.key} has empty title")

    def test_nodes_are_frozen(self) -> None:
        node = build_workspace_nodes()[0]
        with self.assertRaises(AttributeError):
            node.key = "mutated"  # type: ignore[misc]


class EdgeInvariantTests(unittest.TestCase):
    """Tests for workspace edge data invariants."""

    def test_edge_colors_are_valid_hex(self) -> None:
        import re
        hex_re = re.compile(r'^#[0-9A-Fa-f]{6}$')
        for edge in build_workspace_edges():
            self.assertRegex(edge.color, hex_re, f"Edge {edge.start}->{edge.end} has invalid color")

    def test_edge_colors_are_palette_values(self) -> None:
        palette_values = set(PALETTE.values())
        for edge in build_workspace_edges():
            self.assertIn(edge.color, palette_values, f"Edge {edge.start}->{edge.end} color not in PALETTE")

    def test_no_self_loops(self) -> None:
        for edge in build_workspace_edges():
            self.assertNotEqual(edge.start, edge.end, f"Self-loop on {edge.start}")

    def test_edges_are_frozen(self) -> None:
        edge = build_workspace_edges()[0]
        with self.assertRaises(AttributeError):
            edge.start = "mutated"  # type: ignore[misc]


class SidebarInvariantTests(unittest.TestCase):
    """Tests for sidebar block data invariants."""

    def test_sidebar_accents_are_palette_values(self) -> None:
        palette_values = set(PALETTE.values())
        for block in build_sidebar_blocks():
            self.assertIn(block.accent, palette_values, f"Block '{block.title}' accent not in PALETTE")

    def test_sidebar_titles_are_non_empty(self) -> None:
        for block in build_sidebar_blocks():
            self.assertTrue(block.title.strip())

    def test_sidebar_items_are_tuples(self) -> None:
        for block in build_sidebar_blocks():
            self.assertIsInstance(block.items, tuple)

    def test_sidebar_blocks_are_frozen(self) -> None:
        block = build_sidebar_blocks()[0]
        with self.assertRaises(AttributeError):
            block.title = "mutated"  # type: ignore[misc]


class PaletteTests(unittest.TestCase):
    """Tests for PALETTE color dictionary."""

    def test_palette_has_expected_keys(self) -> None:
        for key in ("night_sky", "gold", "leaf", "rose", "cyan", "text", "panel"):
            self.assertIn(key, PALETTE)

    def test_palette_values_are_valid_hex(self) -> None:
        import re
        hex_re = re.compile(r'^#[0-9A-Fa-f]{6}$')
        for key, color in PALETTE.items():
            self.assertRegex(color, hex_re, f"PALETTE['{key}'] = '{color}' is not valid hex")

    def test_palette_is_not_empty(self) -> None:
        self.assertGreater(len(PALETTE), 0)


if __name__ == "__main__":
    unittest.main()