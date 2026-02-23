import unittest
from unittest.mock import patch
from io import StringIO
import sys
from mini_ai.cli import main

class TestCLI(unittest.TestCase):
    @patch('sys.stdout', new_callable=StringIO)
    def test_train(self, mock_stdout):
        input_text = "hello world"
        sys.argv = ['cli.py', 'train', '--input', input_text]
        main()
        self.assertIn('Model trained on input text.', mock_stdout.getvalue())

    @patch('sys.stdout', new_callable=StringIO)
    def test_generate(self, mock_stdout):
        with open('input.txt', 'w') as file:
            file.write("hello world")
        sys.argv = ['cli.py', 'generate', '--length', '10']
        main()
        self.assertIn('START', mock_stdout.getvalue())

if __name__ == '__main__':
    unittest.main()