import unittest
from mini_ai.markov import MarkovChain

class TestMarkovChain(unittest.TestCase):
    def setUp(self):
        self.mc = MarkovChain()

    def test_train_single_word(self):
        self.mc.train('a')
        self.assertEqual(self.mc.chain, {'a': []})

    def test_train_two_words(self):
        self.mc.train('ab')
        self.assertEqual(self.mc.chain, {'a': ['b']})

    def test_train_multiple_words(self):
        self.mc.train('abc abc')
        self.assertEqual(self.mc.chain, {'a': ['b'], 'b': ['c'], ' ': ['c']})

    def test_generate_short_text(self):
        self.mc.train('ab')
        text = self.mc.generate(1)
        self.assertEqual(text, 'ab')

    def test_generate_longer_text(self):
        self.mc.train('abc abc')
        text = self.mc.generate(3)
        self.assertIn('a', text)
        self.assertIn('b', text)
        self.assertIn('c', text)

    def test_generate_with_chaining(self):
        self.mc.train('abc abc')
        text = self.mc.generate(3)
        self.assertEqual(len(text), 3)

if __name__ == '__main__':
    unittest.main()