import unittest

from projects.shumilek_ui.scene import build_sidebar_blocks, build_workspace_edges, build_workspace_nodes, find_node


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


if __name__ == "__main__":
    unittest.main()