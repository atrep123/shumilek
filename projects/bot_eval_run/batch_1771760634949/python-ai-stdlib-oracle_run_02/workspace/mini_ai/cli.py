import argparse
import json
from mini_ai.markov import MarkovChain

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Markov Chain Generator CLI")
    subparsers = parser.add_subparsers(dest='command')

    # Train command
    train_parser = subparsers.add_parser('train', help='Train a Markov chain model.')
    train_parser.add_argument('--input', required=True, type=str, help='Path to the input text file.')
    train_parser.add_argument('--model-out', required=True, type=str, help='Path to save the trained model.')
    train_parser.add_argument('--order', required=True, type=int, help='Order of the Markov chain.')

    # Generate command
    generate_parser = subparsers.add_parser('generate', help='Generate text using a trained Markov chain model.')
    generate_parser.add_argument('--model', required=True, type=str, help='Path to the trained model file.')
    generate_parser.add_argument('--length', required=True, type=int, help='Length of the generated text.')
    generate_parser.add_argument('--seed', type=str, help='Seed string for generation.')
    generate_parser.add_argument('--random-seed', type=int, help='Random seed for reproducibility.')

    args = parser.parse_args(argv)

    if args.command == 'train':
        with open(args.input, 'r', encoding='utf-8') as f:
            text = f.read()
        mc = MarkovChain(order=args.order)
        mc.train(text)
        with open(args.model_out, 'w', encoding='utf-8') as f:
            json.dump(mc.to_dict(), f)
        return 0
    elif args.command == 'generate':
        with open(args.model, 'r', encoding='utf-8') as f:
            d = json.load(f)
        mc = MarkovChain.from_dict(d)
        generated_text = mc.generate(length=args.length, seed=args.seed, random_seed=args.random_seed)
        print(generated_text)
        return 0
    else:
        parser.print_help()
        return 1