import unittest
from mini_ai.cli import train_model, generate_text
from collections import defaultdict
import json

class TestMarkovChain(unittest.TestCase):

    def test_train_model_simple_case(self):
        with open('tests/input_simple.txt', 'w') as f:
            f.write('abacabad')
        model_file = 'tests/model.json'
        train_model('tests/input_simple.txt', model_file)
        with open(model_file, 'r') as f:
            model = defaultdict(lambda: defaultdict(int), json.load(f))
        self.assertEqual(model['a']['b'], 2)
        self.assertEqual(model['a']['c'], 1)
        self.assertEqual(model['b']['a'], 2)
        self.assertEqual(model['c']['a'], 1)
        self.assertEqual(model['d'], defaultdict(int))

    def test_train_model_single_char(self):
        with open('tests/input_single_char.txt', 'w') as f:
            f.write('aaa')
        model_file = 'tests/model.json'
        train_model('tests/input_single_char.txt', model_file)
        with open(model_file, 'r') as f:
            model = defaultdict(lambda: defaultdict(int), json.load(f))
        self.assertEqual(model['a']['a'], 2)
        self.assertEqual(model['a'], defaultdict(lambda: {'a': 0}))

    def test_generate_text_single_char_model(self):
        with open('tests/model.json', 'w') as f:
            json.dump({'a': defaultdict(int)}, f)
        generated_text = generate_text('tests/model.json', 5)
        self.assertEqual(generated_text, 'aaaaa')

    def test_generate_text_simple_case(self):
        with open('tests/input_simple.txt', 'w') as f:
            f.write('abacabad')
        model_file = 'tests/model.json'
        train_model('tests/input_simple.txt', model_file)
        generated_text = generate_text(model_file, 10)
        self.assertEqual(len(generated_text), 10)

if __name__ == '__main__':
    unittest.main()
