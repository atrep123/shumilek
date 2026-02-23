from typing import Dict, List, Optional
import random

class MarkovChain:
    def __init__(self, order: int = 1):
        if order <= 0:
            raise ValueError('Order must be positive.')
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

    def generate(self, length: int, seed: Optional[str] = None, random_seed: Optional[int] = None) -> str:
        if random_seed is not None:
            random.seed(random_seed)
        if seed is None:
            context = random.choice([c for c in self.transitions for c])
        else:
            context = seed

        result = []
        while len(result) < length:
            if context not in self.transitions or sum(self.transitions[context].values()) == 0:
                break
            choices = list(self.transitions[context].keys())
            weights = list(self.transitions[context].values())
            next_char = random.choices(choices, weights)[0]
            result.append(next_char)
            context = context[-self.order + 1:] + next_char
        return ''.join(result)

    def to_dict(self) -> Dict:
        return {"order": self.order, "transitions": self.transitions}

    @classmethod
    def from_dict(cls, d: Dict) -> 'MarkovChain':
        mc = cls()
        mc.order = d['order']
        mc.transitions = d['transitions']
        return mc
