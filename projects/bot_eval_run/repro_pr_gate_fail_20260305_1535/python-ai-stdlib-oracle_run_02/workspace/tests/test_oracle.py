import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stdout

from mini_ai.markov import MarkovChain
from mini_ai.cli import main


class TestMarkovOracle(unittest.TestCase):
    def test_order_validation(self):
        with self.assertRaises(ValueError):
            MarkovChain(order=0)

    def test_train_and_to_dict(self):
        mc = MarkovChain(order=1)
        mc.train("aba")
        d = mc.to_dict()
        self.assertEqual(d["order"], 1)
        self.assertIn("transitions", d)
        self.assertIn("a", d["transitions"])
        self.assertIn("b", d["transitions"]["a"])
        self.assertEqual(d["transitions"]["a"]["b"], 1)

    def test_round_trip_serialization(self):
        mc = MarkovChain(order=2)
        mc.train("abcd")
        d1 = mc.to_dict()
        mc2 = MarkovChain.from_dict(d1)
        d2 = mc2.to_dict()
        self.assertEqual(d1["order"], d2["order"])
        self.assertEqual(d1["transitions"], d2["transitions"])

    def test_generate_deterministic(self):
        mc = MarkovChain(order=1)
        mc.train("aba")
        out = mc.generate(length=10, seed="a", random_seed=0)
        self.assertEqual(len(out), 10)
        self.assertTrue(set(out) <= {"a", "b"})


class TestCliOracle(unittest.TestCase):
    def test_train_and_generate_smoke(self):
        with tempfile.TemporaryDirectory() as td:
            input_path = os.path.join(td, "input.txt")
            model_path = os.path.join(td, "model.json")

            with open(input_path, "w", encoding="utf-8") as f:
                f.write("aba")

            rc = main(["train", "--input", input_path, "--model-out", model_path, "--order", "1"])
            self.assertEqual(rc, 0)
            self.assertTrue(os.path.exists(model_path))

            with open(model_path, "r", encoding="utf-8") as f:
                loaded = json.load(f)
            self.assertIn("order", loaded)
            self.assertIn("transitions", loaded)

            buf = io.StringIO()
            with redirect_stdout(buf):
                rc2 = main(["generate", "--model", model_path, "--length", "12", "--seed", "a", "--random-seed", "0"])
            self.assertEqual(rc2, 0)
            generated = buf.getvalue().strip()
            self.assertEqual(len(generated), 12)

