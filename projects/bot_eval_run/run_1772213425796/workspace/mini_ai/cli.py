from __future__ import annotations

import argparse
import json

from mini_ai.markov import MarkovChain

def _save_model(model: MarkovChain, path: str) -> None:
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(model.to_dict(), f, ensure_ascii=False)

def _load_model(path: str) -> MarkovChain:
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    return MarkovChain.from_dict(data)

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Character-level Markov chain generator.')
    sub = parser.add_subparsers(dest='command')

    p_train = sub.add_parser('train', help='Train a model')
    p_train.add_argument('--input', required=True)
    p_train.add_argument('--model-out', required=True)
    p_train.add_argument('--order', type=int, default=1)

    p_generate = sub.add_parser('generate', help='Generate text')
    p_generate.add_argument('--model', required=True)
    p_generate.add_argument('--length', type=int, required=True)
    p_generate.add_argument('--seed', default=None)
    p_generate.add_argument('--random-seed', type=int, default=None)

    args = parser.parse_args(argv)

    if args.command == 'train':
        with open(args.input, 'r', encoding='utf-8') as f:
            text = f.read()
        model = MarkovChain(order=args.order)
        model.train(text)
        _save_model(model, args.model_out)
        return 0

    if args.command == 'generate':
        model = _load_model(args.model)
        print(model.generate(length=args.length, seed=args.seed, random_seed=args.random_seed))
        return 0

    parser.print_help()
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
