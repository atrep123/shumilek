import random

class MarkovChain:
    def __init__(self):
        self.chain = {}

    def add_text(self, text):
        words = ["START"] + list(text) + ["END"]
        for i in range(len(words) - 1):
            if words[i] in self.chain:
                self.chain[words[i]].append(words[i+1])
            else:
                self.chain[words[i]] = [words[i+1]]

    def generate_text(self, length):
        text = ""
        current_word = random.choice(list(self.chain.keys()))
        while len(text) < length:
            if current_word != "END":
                text += current_word
                current_word = random.choice(self.chain[current_word])
        return text + "END"
