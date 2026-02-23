# Mini AI Project

This is a simple implementation of a character-level Markov chain generator using Python.

## Features

- Implements a MarkovChain class with methods to train and generate text based on the trained model.
- Provides a CLI for training the model from a text file and generating new text based on the trained model.

## Installation

To install this package, you can use pip:
```bash
pip install .
```

## Usage

### Training the Model

You can train the model using a text file with the following command:
```bash
python -m mini_ai.cli train --input <path-to-text-file> --model-out <path-to-output-json> --order <int>
```

### Generating Text

You can generate text using the trained model with the following command:
```bash
python -m mini_ai.cli generate --model <path-to-model-json> --length <int> [--seed <str>] [--random-seed <int>]
```

## Documentation

For more details, please refer to the documentation included in the repository.
