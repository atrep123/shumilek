import unittest
from mini_ai.markov import MarkovChain
import random

class TestMarkov(unittest.TestCase):
    def test_add_text(self):
        markov = MarkovChain()
        text = "hello world"
        markov.add_text(text)
        self.assertEqual(markov.chain, {"START": ["h"], "h": ["e"], "e": ["l"], "l": ["o", "a"], "o": ["w"], "w": ["o"], "o": ["r"], "r": ["d"], "d": ["END"]})

    def test_generate_text(self):
        markov = MarkovChain()
        text = "hello world fifteen times"
        markov.add_text(text)
        generated_text = markov.generate_text(10)
        self.assertIn("START", generated_text)
        self.assertNotIn("fifteen", generated_text)

if __name__ == '__main__':
    unittest.main()
