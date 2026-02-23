    def generate(self, length: int, seed: str | None = None, random_seed: int | None = None) -> str:
        if random_seed is not None:
            random.seed(random_seed)
        elif seed is not None:
            random.seed(seed)

        if seed is None or seed not in self.transitions:
            context = ''.join([random.choice(list(self.transitions.keys())) for _ in range(self.order)])
        else:
            context = seed[:self.order]

        result: List[str] = list(context)  # type: ignore
        for _ in range(length - len(context)):
            if context not in self.transitions or len(self.transitions[context]) == 0:
                break
            next_char = random.choice(list(self.transitions[context].keys()))  # type: ignore
            result.append(next_char)  # type: ignore
            context = ''.join(result[-self.order:])  # type: ignore
        return ''.join(result)
