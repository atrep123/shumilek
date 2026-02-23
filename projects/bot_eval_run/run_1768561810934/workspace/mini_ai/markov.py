from typing import Dict, Optional
import random
class MarkovChain:
    def __init__(self, order: int = 1):
        if order <= 0:
            raise ValueError('Order must be greater than 0')
        self.order = order
        self.transitions: Dict[str, Dict[str, int]] = {}

    def train(self, text: str) -> None:
        for i in range(len(text) - self.order):
            context = text[i:i+self.order]
            next_char = text[i+self.order]
            if context not in self.transitions:
                self.transitions[context] = {}
            if next_char not in self.transitions[context]:
                self.transitions[context][next_char] = 0
            self.transitions[context][next_char] += 1

    def generate(self, length: int, seed: Optional[str] = None, random_seed: Optional[int] = None) -> str:
        if random_seed is not None:
            random.seed(random_seed)
        if seed is not None and len(seed) == self.order:
            context = seed
        else:
            context = random.choice(list(self.transitions.keys()))
        result = list(context)
        for _ in range(length - self.order):
            next_char_options = self.transitions.get(context, {})
            if not next_char_options:
                break
            total_count = sum(next_char_options.values())
            rand_val = random.randint(1, total_count)
            cumulative_count = 0
            for next_char, count in next_char_options.items():
                cumulative_count += count
                if rand_val <= cumulative_count:
                    result.append(next_char)
                    context = context[1:] + next_char
                    break
        return ''.join(result)

    def to_dict(self) -> dict:
        return {
            'order': self.order,
            'transitions': self.transitions
        }

    @classmethod
    def from_dict(cls, d: dict) -> MarkovChain:
        mc = cls(order=d['order'])
        mc.transitions = d['transitions']
        return mc