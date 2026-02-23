import argparse

def train():
    print('Training model')

def generate(model_path):
    print(f'Generating text from {model_path}')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='AI CLI')
    subparsers = parser.add_subparsers()
    train_parser = subparsers.add_parser('train', help='Train the AI model')
    train_parser.set_defaults(func=train)
    generate_parser = subparsers.add_parser('generate', help='Generate text using a trained model')
    generate_parser.add_argument('model_path', type=str, help='Path to the trained model')
    generate_parser.set_defaults(func=generate)
    args = parser.parse_args()
    if hasattr(args, 'func'):
        args.func(args.model_path)