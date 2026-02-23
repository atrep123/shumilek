# Mini AI Project

This is a simple implementation of a character-level Markov chain generator using Python.

## Features

- Uses only standard Python library (no external dependencies).
- Implements a MarkovChain class with methods to train and generate text based on the model.
- Provides a CLI for training the model from a text file and generating new text from the trained model.

## Installation

No installation is required. Simply clone this repository and run the provided scripts.

## Usage

### Training the Model

To train the Markov chain model, use the following command:
```bash
train --input <path_to_text_file> --model-out <path_to_output_json> --order <int>
```

Example:
```bash
train --input input.txt --model-out model.json --order 1
```

### Generating Text

To generate text using the trained model, use the following command:
```bash
generate --model <path_to_model_json> --length <int> [--seed <str>] [--random-seed <int>]
```

Example:
```bash
generate --model model.json --length 100 --seed 'a' --random-seed 42
```

## Documentation for Code

### MarkovChain Class

The `MarkovChain` class is responsible for training the model and generating text based on it.

#### Methods:

- **`__init__(order: int = 1)`**: Initializes the Markov chain with a given order.
- **`train(self, text: str) -> None`**: Trains the model on the provided text.
- **`generate(self, length: int, seed: str | None = None, random_seed: int | None = None) -> str`**: Generates a string of specified length based on the trained model. Optionally starts with a given seed and uses a specific random seed for reproducibility.
- **`to_dict() -> dict`**: Converts the model to a dictionary format that can be serialized to JSON.
- **`from_dict(cls, d: dict) -> 'MarkovChain'`**: Creates a `MarkovChain` instance from a dictionary representation.

### CLI Module

The `cli.py` module provides a command-line interface for training and generating text using the Markov chain model.

#### Functions:

- **`main(argv: list[str] | None = None) -> int`**: Main function that parses arguments and calls appropriate subcommands.
- **`train_command(input_path: str, output_path: str, order: int) -> None`**: Subcommand to train the model from a text file and save it as a JSON file.
- **`generate_command(model_path: str, length: int, seed: str | None = None, random_seed: int | None = None) -> None`**: Subcommand to generate text based on the trained model.
