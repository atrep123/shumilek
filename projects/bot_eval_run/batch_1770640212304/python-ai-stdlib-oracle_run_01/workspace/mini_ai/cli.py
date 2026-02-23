import argparse
import json
from .markov import MarkovChain

def main(argv=None):
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers()

    train_parser = subparsers.add_parser("train")
    train_parser.add_argument("--input", type=str, required=True)
    train_parser.add_argument("--model-out", type=str, required=True)
    train_parser.add_argument("--order", type=int, required=True)
    train_parser.set_defaults(func=train)

    generate_parser = subparsers.add_parser("generate")
    generate_parser.add_argument("--model", type=str, required=True)
    generate_parser.add_argument("--length", type=int, required=True)
    generate_parser.add_argument("--seed")
    generate_parser.add_argument("--random-seed", type=int)
    generate_parser.set_defaults(func=generate)

    args = parser.parse_args(argv)
    return args.func(args) if hasattr(args, "func") else 0

def train(args):
    with open(args.input, "r", encoding="utf-8") as f:
        text = f.read()
    mc = MarkovChain(order=args.order)
    mc.train(text)
    with open(args.model_out, "w", encoding="utf-8") as f:
        json.dump(mc.to_dict(), f)
    return 0

def generate(args):
    with open(args.model, "r", encoding="utf-8") as f:
        model = MarkovChain.from_dict(json.load(f))
    generated_text = model.generate(length=args.length, seed=args.seed, random_seed=args.random_seed)
    print(generated_text)
    return 0
