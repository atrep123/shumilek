class MarkovChain:
    def __init__(self, order: int = 1):
        self.order = order
        self.transitions = {}

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
        import random
        if seed is None:
            seed = next(iter(self.transitions))
        if random_seed is not None:
            random.seed(random_seed)
        result = list(seed)
        context = seed
        for _ in range(length - len(seed)):
            if context not in self.transitions or not self.transitions[context]:
                break
            chars = list(self.transitions[context].keys())
            weights = list(self.transitions[context].values())
            next_char = random.choices(chars, weights)[0]
            result.append(next_char)
            context = ''.join([context[1:], next_char])
        return ''.join(result)

    def to_dict(self) -> dict:
        return {"order": self.order, "transitions": self.transitions}

    @staticmethod
    def from_dict(d: dict):
        mc = MarkovChain(order=d['order'])
        mc.transitions = d['transitions']
        return mc
