from __future__ import annotations
import random
from typing import Dict, Optional

class MarkovChain:
    def __init__(self, order: int = 1):
        if order <= 0:
            raise ValueError("Order must be greater than 0.")
        self.order = order
        self.transitions: Dict[str, Dict[str, int]] = {}

    def train(self, text: str) -> None:
        for i in range(len(text) - self.order):
            context = text[i:i + self.order]
            next_char = text[i + self.order]
            if context not in self.transitions:
                self.transitions[context] = {}
            if next_char not in self.transitions[context]:
                self.transitions[context][next_char] = 0
            self.transitions[context][next_char] += 1

    def generate(self, length: int, seed: Optional[str] = None, random_seed: Optional[int] = None) -> str:
        if random_seed is not None:
            random.seed(random_seed)
        if seed is None:
            seed = random.choice(list(self.transitions.keys()))
        if len(seed) != self.order:
            raise ValueError(f"Seed must be of length {self.order}.")
        result = list(seed)
        for _ in range(length - self.order):
            context = ''.join(result[-self.order:])
            if context not in self.transitions:
                break
            next_char = random.choices(list(self.transitions[context].keys()), weights=self.transitions[context].values())[0]
            result.append(next_char)
        return ''.join(result)

    def to_dict(self) -> dict:
        return {
            "order": self.order,
            "transitions": self.transitions
        }

    @classmethod
    def from_dict(cls, d: dict) -> "MarkovChain":
        mc = cls(order=d["order"])
        mc.transitions = d["transitions"]
        return mc
