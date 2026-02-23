import argparse
import json
from .markov import MarkovChain

def main(argv: list[str] | None = None) -> int:
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
    generate_parser.add_argument("--seed", type=str, default=None)
    generate_parser.add_argument("--random-seed", type=int, default=None)
    generate_parser.set_defaults(func=generate)

    args = parser.parse_args(argv)
    return args.func(args)

def train(args) -> int:
    with open(args.input, "r", encoding="utf-8") as f:
        text = f.read()
    mc = MarkovChain(order=args.order)
    mc.train(text)
    with open(args.model_out, "w", encoding="utf-8") as f:
        json.dump(mc.to_dict(), f)
    return 0

def generate(args) -> int:
    with open(args.model, "r", encoding="utf-8") as f:
        model_data = json.load(f)
    mc = MarkovChain.from_dict(model_data)
    generated_text = mc.generate(length=args.length, seed=args.seed, random_seed=args.random_seed)
    print(generated_text)
    return 0
