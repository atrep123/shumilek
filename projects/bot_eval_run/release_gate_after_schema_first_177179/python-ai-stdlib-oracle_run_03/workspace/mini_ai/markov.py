from __future__ import annotations
import json
import random

class MarkovChain:
    def __init__(self, order: int = 1):
        if order <= 0:
            raise ValueError("Order must be greater than 0.")
        self.order = order
        self.transitions = {}

    def train(self, text: str) -> None:
        for i in range(len(text) - self.order):
            context = text[i:i + self.order]
            next_char = text[i + self.order]
            if context not in self.transitions:
                self.transitions[context] = {}
            if next_char not in self.transitions[context]:
                self.transitions[context][next_char] = 0
            self.transitions[context][next_char] += 1

    def generate(self, length: int, seed: str = None, random_seed: int = None) -> str:
        if seed is not None and len(seed) != self.order:
            raise ValueError(f"Seed must be of length {self.order}.")
        if random_seed is not None:
            random.seed(random_seed)

        if seed is None:
            context = random.choice(list(self.transitions.keys()))
        else:
            context = seed

        result = list(context)
        for _ in range(length - self.order):
            next_char = random.choices(
                population=list(self.transitions[context].keys()),
                weights=self.transitions[context].values(),
                k=1
            )[0]
            result.append(next_char)
            context = ''.join(result[-self.order:])
        return ''.join(result)

    def to_dict(self) -> dict:
        return {
            "order": self.order,
            "transitions": self.transitions
        }

    @classmethod
    def from_dict(cls, data: dict) -> MarkovChain:
        instance = cls(order=data["order"])
        instance.transitions = data["transitions"]
        return instance
