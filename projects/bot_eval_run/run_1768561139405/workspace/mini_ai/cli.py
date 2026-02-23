import sys
from collections import defaultdict
import json

def train_model(input_file, model_file):
    with open(input_file, 'r') as f:
        text = f.read()
    model = defaultdict(lambda: defaultdict(int))
    for i in range(len(text) - 1):
        current_char = text[i]
        next_char = text[i + 1]
        model[current_char][next_char] += 1
    with open(model_file, 'w') as f:
        json.dump(dict(model), f)

def generate_text(model_file, output_length):
    with open(model_file, 'r') as f:
        model = defaultdict(lambda: defaultdict(int), json.load(f))
    current_char = text[0]
    generated_text = current_char
    for _ in range(output_length - 1):
        next_char = max(model[current_char], key=model[current_char].get)
        generated_text += next_char
        current_char = next_char
    return generated_text

def main():
    if len(sys.argv) < 3:
        print('Unknown command')
        sys.exit(1)
    command = sys.argv[1]
    if command == 'train':
        train_model(sys.argv[2], sys.argv[3])
    elif command == 'generate':
        text = generate_text(sys.argv[2], int(sys.argv[3]))
        print(text)
    else:
        print('Unknown command')
        sys.exit(1)

if __name__ == '__main__':
    main()
