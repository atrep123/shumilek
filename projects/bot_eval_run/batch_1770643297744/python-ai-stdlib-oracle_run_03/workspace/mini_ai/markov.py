def generate(self, length: int, seed: str | None = None, random_seed: int | None = None) -> str:
    if random_seed is not None:
        import random
        random.seed(random_seed)
    elif seed is not None:
        import random
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
        context = ''.join(result[-self.order:])
    return ''.join(result)
