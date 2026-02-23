from typing import Dict, Tuple, List, Any
import random

class MarkovChain:
    def __init__(self, order: int = 1):
        if order <= 0:
            raise ValueError("Order must be positive.")
        self.order = order
        self.transitions: Dict[str, Dict[str, int]] = {}

    def train(self, text: str) -> None:
        for i in range(len(text) - self.order):
            context = text[i:i + self.order]
            next_char = text[i + self.order]
            if context not in self.transitions:
                self.transitions[context] = {next_char: 1}
            else:
                self.transitions[context][next_char] = self.transitions[context].get(next_char, 0) + 1

    def generate(self, length: int, seed: str | None = None, random_seed: int | None = None) -> str:
        if random_seed is not None:
            random.seed(random_seed)
        elif seed is not None:
            random.seed(seed[:self.order])

        text: List[str] = []
        context = seed[:self.order] if seed else random.choice(list(self.transitions.keys()))

        for _ in range(length):
            if context not in self.transitions:
                break

            next_chars = list(self.transitions[context].keys())
            weights = list(self.transitions[context].values())
            next_char = random.choices(next_chars, weights)[0]

            text.append(next_char)
            context = context[1:] + next_char

        return "".join(text)

    def to_dict(self) -> Dict[str, Any]:
        return {"order": self.order, "transitions": self.transitions}

    @staticmethod
    def from_dict(d: Dict[str, Any]) -> "MarkovChain":
        mc = MarkovChain(order=d["order"])  # type: ignore
        mc.transitions = d["transitions"]  # type: ignore
        return mc
