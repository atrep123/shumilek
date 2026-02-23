class MarkovChain:
    def __init__(self):
        self.chain = {}

    def train(self, text):
        words = list(text)
        for i in range(len(words) - 1):
            if words[i] not in self.chain:
                self.chain[words[i]] = []
            self.chain[words[i]].append(words[i + 1])

    def generate(self, length=50):
        import random
        first_word = random.choice(list(self.chain.keys()))
        result = [first_word]
        while len(result) < length:
            next_word = random.choice(self.chain[result[-1]])
            result.append(next_word)
        return ''.join(result)
