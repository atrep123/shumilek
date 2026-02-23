import unittest
from mini_ai.trainer import train

class TestTrainer(unittest.TestCase):
    def test_train(self):
        with self.assertRaises(FileNotFoundError):
            train('non_existent_file.txt', 'model.pth')
