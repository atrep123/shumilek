from typing import Dict, List, Tuple, Union
import random

class MarkovChain:
    def __init__(self, order: int = 1):
        if order <= 0:
            raise ValueError("Order must be a positive integer.")
        self.order = order
        self.transitions: Dict[str, Dict[str, int]] = {}

    def train(self, text: str) -> None:
        for i in range(len(text) - self.order):
            context = text[i:i + self.order]
            next_char = text[i + self.order]
            if context not in self.transitions:
                self.transitions[context] = {next_char: 1}
            else:
                if next_char in self.transitions[context]:
                    self.transitions[context][next_char] += 1
                else:
                    self.transitions[context][next_char] = 1

    def generate(self, length: int, seed: str | None = None, random_seed: int | None = None) -> str:
        if random_seed is not None:
            random.seed(random_seed)
        elif seed is not None:
            random.seed(seed)

        if seed is None or seed not in self.transitions:
            context = random.choice(list(self.transitions.keys()))
        else:
            context = seed

        result: List[str] = list(context)
        for _ in range(length - len(context)):
            if context not in self.transitions or len(self.transitions[context]) == 0:
                break
            next_char = random.choice(list(self.transitions[context].keys()))
            result.append(next_char)
            context = result[-self.order:]
        return ''.join(result)

    def to_dict(self) -> dict:
        return {"order": self.order, "transitions": self.transitions}

    @classmethod
    def from_dict(cls, d: dict) -> "MarkovChain":
        mc = cls(order=d["order"])  # type: ignore
        mc.transitions = d["transitions"]  # type: ignore
        return mc
