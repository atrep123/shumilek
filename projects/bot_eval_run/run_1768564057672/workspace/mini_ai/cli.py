import argparse
import json
from mini_ai.markov import MarkovChain

def main(argv=None):
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest='command')

    train_parser = subparsers.add_parser('train')
    train_parser.add_argument('--input', type=str, required=True)
    train_parser.add_argument('--model-out', type=str, required=True)
    train_parser.add_argument('--order', type=int, required=True)

    generate_parser = subparsers.add_parser('generate')
    generate_parser.add_argument('--model', type=str, required=True)
    generate_parser.add_argument('--length', type=int, required=True)
    generate_parser.add_argument('--seed', type=str, default=None)
    generate_parser.add_argument('--random-seed', type=int, default=None)

    args = parser.parse_args(argv)

    if args.command == 'train':
        mc = MarkovChain(order=args.order)
        with open(args.input, 'r') as f:
            text = f.read()
        mc.train(text)
        with open(args.model_out, 'w') as f:
            json.dump(mc.to_dict(), f)
    elif args.command == 'generate':
        with open(args.model, 'r') as f:
            model_data = json.load(f)
        mc = MarkovChain.from_dict(model_data)
        generated_text = mc.generate(length=args.length, seed=args.seed, random_seed=args.random_seed)
        print(generated_text)
    return 0
