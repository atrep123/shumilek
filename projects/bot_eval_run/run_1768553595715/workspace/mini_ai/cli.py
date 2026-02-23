import argparse
from .markov import MarkovChain

def main():
    parser = argparse.ArgumentParser(description="Mini AI CLI for text generation.")
    subparsers = parser.add_subparsers(dest='command')

    train_parser = subparsers.add_parser('train', help='Train the model on a given text file.')
    train_parser.add_argument('--input', required=True, help='Input text file to train on.')

    generate_parser = subparsers.add_parser('generate', help='Generate text based on the trained model.')
    generate_parser.add_argument('--length', type=int, default=50, help='Length of the generated text.')

    args = parser.parse_args()

    if args.command == 'train':
        markov = MarkovChain()
        with open(args.input, 'r') as file:
            text = file.read().replace('\n', ' ')
            markov.add_text(text)
        print("Model trained on input text.")
    elif args.command == 'generate':
        markov = MarkovChain()
        with open('input.txt', 'r') as file:
            text = file.read().replace('\n', ' ')
            markov.add_text(text)
        generated_text = markov.generate_text(args.length)
        print(generated_text)

if __name__ == '__main__':
    main()
