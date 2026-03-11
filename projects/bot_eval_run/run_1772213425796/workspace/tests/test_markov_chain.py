import unittest
from mini_ai.markov_chain import MarkovChain
class TestMarkovChain(unittest.TestCase):
    def test_train(self):
        mc = MarkovChain(order=2)
        mc.train('hello world')
        self.assertIn(('he',), mc.chain)
        self.assertIn(('lo',), mc.chain)
        self.assertIn(('or',), mc.chain)

    def test_generate(self):
        mc = MarkovChain(order=1)
        mc.train('abracadabra')
        generated_text = mc.generate(length=10, random_seed=42)
        self.assertEqual(len(generated_text), 10)

    def test_to_dict_and_from_dict(self):
        mc = MarkovChain(order=2)
        mc.train('hello world')
        data = mc.to_dict()
        new_mc = MarkovChain.from_dict(data)
        self.assertEqual(new_mc.order, mc.order)
        self.assertEqual(new_mc.chain, mc.chain)

    def test_seed(self):
        mc = MarkovChain(order=1)
        mc.train('abracadabra')
        generated_text_1 = mc.generate(length=10, seed='a', random_seed=42)
        generated_text_2 = mc.generate(length=10, seed='a', random_seed=42)
        self.assertEqual(generated_text_1, generated_text_2)
