import argparse
import json
from mini_ai.markov import MarkovChain

def main(argv: list[str] | None = None):
    parser = argparse.ArgumentParser(description='Text generation using a Markov chain.')
    subparsers = parser.add_subparsers()

    train_parser = subparsers.add_parser('train', help='Train the model from input text file.')
    train_parser.add_argument('--input', type=str, required=True, help='Path to the input text file.')
    train_parser.add_argument('--model-out', type=str, required=True, help='Path to save the trained model.')
    train_parser.add_argument('--order', type=int, required=True, help='Order of the Markov chain.')
    train_parser.set_defaults(func=train_command)

    generate_parser = subparsers.add_parser('generate', help='Generate text using a trained model.')
    generate_parser.add_argument('--model', type=str, required=True, help='Path to the trained model JSON file.')
    generate_parser.add_argument('--length', type=int, required=True, help='Length of the generated text.')
    generate_parser.add_argument('--seed', type=str, default=None, help='Seed for text generation.')
    generate_parser.add_argument('--random-seed', type=int, default=None, help='Random seed for reproducibility.')
    generate_parser.set_defaults(func=generate_command)

    args = parser.parse_args(argv)
    if 'func' in args:
        args.func(**vars(args))
    else:
        parser.print_help()

def train_command(input_path: str, output_path: str, order: int):
    with open(input_path, 'r') as file:
        text = file.read().strip()
    model = MarkovChain(order)
    model.train(text)
    with open(output_path, 'w') as json_file:
        json.dump(model.to_dict(), json_file)

def generate_command(model_path: str, length: int, seed: str | None = None, random_seed: int | None = None):
    with open(model_path, 'r') as json_file:
        model_data = json.load(json_file)
    model = MarkovChain.from_dict(model_data)
    generated_text = model.generate(length, seed, random_seed)
    print(generated_text)
