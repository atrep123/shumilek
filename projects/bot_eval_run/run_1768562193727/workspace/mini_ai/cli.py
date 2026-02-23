import argparse
import json
from mini_ai.markov import MarkovChain

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Character-level Markov chain generator')
    subparsers = parser.add_subparsers(dest='command', required=True)

    train_parser = subparsers.add_parser('train', help='Train a Markov model')
    train_parser.add_argument('--input', type=str, required=True, help='Input text file path')
    train_parser.add_argument('--model-out', type=str, required=True, help='Output model file path')
    train_parser.add_argument('--order', type=int, default=1, help='Order of the Markov chain')

    generate_parser = subparsers.add_parser('generate', help='Generate text from a Markov model')
    generate_parser.add_argument('--model', type=str, required=True, help='Model file path')
    generate_parser.add_argument('--length', type=int, required=True, help='Length of the generated text')
    generate_parser.add_argument('--seed', type=str, default=None, help='Seed for the generation')
    generate_parser.add_argument('--random-seed', type=int, default=None, help='Random seed for reproducibility')

    args = parser.parse_args(argv)

    if args.command == 'train':
        with open(args.input, 'r', encoding='utf-8') as f:
            text = f.read()
        mc = MarkovChain(order=args.order)
        mc.train(text)
        with open(args.model_out, 'w', encoding='utf-8') as f:
            json.dump(mc.to_dict(), f)
    elif args.command == 'generate':
        with open(args.model, 'r', encoding='utf-8') as f:
            d = json.load(f)
        mc = MarkovChain.from_dict(d)
        generated_text = mc.generate(length=args.length, seed=args.seed, random_seed=args.random_seed)
        print(generated_text)

    return 0
