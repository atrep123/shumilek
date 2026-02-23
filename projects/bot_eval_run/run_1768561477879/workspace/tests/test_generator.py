import unittest
from mini_ai.generator import generate

class TestGenerator(unittest.TestCase):
    def test_generate(self):
        self.assertIsNotNone(generate('model.pth'))
