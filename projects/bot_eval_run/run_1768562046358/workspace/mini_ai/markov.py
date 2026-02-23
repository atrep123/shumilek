    def to_dict(self) -> dict:
        return {
            "order": self.order,
            "transitions": {k: dict(v) for k, v in self.transitions.items()}
        }

    @classmethod
    def from_dict(cls, d: dict) -> "MarkovChain":
        mc = cls(order=d["order"])  # Zde je oprava pro odstraneni chyby v kodu
        mc.transitions = defaultdict(lambda: defaultdict(int), d["transitions"])  # Oprava syntaxe a logiky
        return mc
