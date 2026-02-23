#!/usr/bin/env python3
import argparse
from mini_ai.markov import MarkovChain, load_model, save_model

def main(args=None):
    parser = argparse.ArgumentParser(description="Markov Chain Text Generator")
    subparsers = parser.add_subparsers(dest='command')

    train_parser = subparsers.add_parser('train', help='Train a Markov Chain model')
    train_parser.add_argument('--input', required=True, help='Input text file')
    train_parser.add_argument('--model-out', required=True, help='Output model file')
    train_parser.add_argument('--order', type=int, default=1, help='Order of the Markov Chain')

    generate_parser = subparsers.add_parser('generate', help='Generate text using a Markov Chain model')
    generate_parser.add_argument('--model', required=True, help='Model file')
    generate_parser.add_argument('--length', type=int, default=100, help='Length of the generated text')
    generate_parser.add_argument('--seed', help='Seed for the generation')
    generate_parser.add_argument('--random-seed', type=int, help='Random seed for reproducibility')

    args = parser.parse_args(args)

    if args.command == 'train':
        with open(args.input, 'r', encoding='utf-8') as f:
            text = f.read()
        mc = MarkovChain(order=args.order)
        mc.train(text)
        save_model(mc, args.model_out)
        return 0
    elif args.command == 'generate':
        mc = load_model(args.model)
        generated_text = mc.generate(length=args.length, seed=args.seed, random_seed=args.random_seed)
        print(generated_text)
        return 0
    else:
        parser.print_help()
        return 1
