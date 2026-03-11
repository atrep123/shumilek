import unittest
from unittest.mock import patch
from io import StringIO
from mini_ai.cli import main
import os
from mini_ai.markov import MarkovChain

class TestCLI(unittest.TestCase):
    @patch('sys.argv', ['script.py', 'train', '--input', 'test.txt', '--model-out', 'model.json'])
    def test_train_command(self):
        with open('test.txt', 'w') as f:
            f.write("hello world")
        main()
        self.assertTrue(os.path.exists('model.json'))

    @patch('sys.argv', ['script.py', 'generate', '--model', 'model.json', '--length', '5'])
    @patch('sys.stdout', new_callable=StringIO)
    def test_generate_command(self, mock_stdout):
        with open('model.json', 'w') as f:
            import json
            model = MarkovChain(order=1)
            model.train("hello world")
            json.dump(model.to_dict(), f)
        main()
        output = mock_stdout.getvalue().strip()
        self.assertEqual(len(output), 5)
