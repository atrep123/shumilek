import argparse
import json
import os
from mini_ai.markov import MarkovChain

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Mini AI CLI')
    subparsers = parser.add_subparsers()

    train_parser = subparsers.add_parser('train', help='Train the model from a text file.')
    train_parser.add_argument('--input', type=str, required=True, help='Path to the input text file.')
    train_parser.add_argument('--model-out', type=str, required=True, help='Path to save the trained model.')
    train_parser.add_argument('--order', type=int, required=True, help='Order of the Markov chain.')
    train_parser.set_defaults(func=train)

    generate_parser = subparsers.add_parser('generate', help='Generate text using a trained model.')
    generate_parser.add_argument('--model', type=str, required=True, help='Path to the input model file.')
    generate_parser.add_argument('--length', type=int, required=True, help='Length of the generated text.')
    generate_parser.add_argument('--seed', type=str, default=None, help='Seed for text generation.')
    generate_parser.add_argument('--random-seed', type=int, default=None, help='Random seed for reproducibility.')
    generate_parser.set_defaults(func=generate)

    args = parser.parse_args(argv) if argv is not None else parser.parse_args()
    return args.func(args)

def train(args):
    with open(args.input, 'r', encoding='utf-8') as file:
        text = file.read().strip()
    mc = MarkovChain(order=args.order)
    mc.train(text)
    with open(args.model_out, 'w', encoding='utf-8') as outfile:
        json.dump(mc.to_dict(), outfile)
    return 0

def generate(args):
    with open(args.model, 'r', encoding='utf-8') as file:
        model = MarkovChain.from_dict(json.load(file))
    generated_text = model.generate(length=args.length, seed=args.seed, random_seed=args.random_seed)
    print(generated_text)
    return 0
