# Mini AI

This project implements a character-level Markov chain generator using Python's standard library.

## Features

- Implements a MarkovChain class with methods to train and generate text based on the model.
- Provides a CLI for training the model from a text file and generating new text based on the trained model.

## Installation

Possibly, you can install this package using pip:
```bash
pip install .
```

## Usage

### Training the Model
To train the Markov chain model from a text file and save it to a JSON file, use the following command:
```bash
python -m mini_ai.cli train --input <path-to-text-file> --model-out <path-to-output-json> --order <int>
```

### Generating Text
To generate text based on the trained model, use:
```bash
python -m mini_ai.cli generate --model <path-to-input-json> --length <int> [--seed <str>] [--random-seed <int>]
```

## Documentation for Developers

### MarkovChain Class
This class implements a character-level Markov chain model.

#### Methods:
- `__init__(order: int = 1)`: Initializes the MarkovChain with a given order.
- `train(text: str) -> None`: Trains the model on the provided text.
- `generate(length: int, seed: str | None = None, random_seed: int | None = None) -> str`: Generates text of specified length based on the trained model. Optionally starts with a given seed and uses a specific random seed for reproducibility.
- `to_dict() -> dict`: Converts the model to a dictionary representation that can be serialized to JSON.
- `from_dict(d: dict) -> "MarkovChain"`: Creates a MarkovChain instance from a dictionary representation.

### CLI Module
This module provides a command-line interface for training and generating text based on the Markov chain model.

#### Functions:
- `main(argv: list[str] | None = None) -> int`: Main function to parse arguments and call appropriate subcommands.
- `train(args) -> int`: Subcommand to train the model from a text file and save it to a JSON file.
- `generate(args) -> int`: Subcommand to generate text based on the trained model.

## Testing
To run tests, use:
```bash
python -m unittest discover -v -s tests -p "test*.py"
```

### Example
Here's an example of how you can train and generate text using the CLI:
```bash
train --input input.txt --model-out model.json --order 1
generate --model model.json --length 100 --seed "start" --random-seed 42
```
