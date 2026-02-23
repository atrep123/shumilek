# Mini AI Project

This is a simple implementation of a character-level Markov chain generator using Python.

## Features

- Uses only standard Python library (no numpy, pandas, sklearn, torch, tensorflow, requests).
- Implements a MarkovChain class with methods to train and generate text based on the model.
- Provides a CLI for training the model from a text file and generating new text using the trained model.

## Installation

1. Clone the repository: `git clone https://github.com/yourusername/mini_ai.git`
2. Navigate to the project directory: `cd mini_ai`
3. Install dependencies: `pip install -r requirements.txt`

## Usage

### Training the Model

To train the model, use the following command:
```sh
python -m mini_ai.cli train --input <path-to-text-file> --model-out <path-to-output-json> --order <int>
```

### Generating Text

To generate text using the trained model, use the following command:
```sh
python -m mini_ai.cli generate --model <path-to-input-json> --length <int> [--seed <str>] [--random-seed <int>]
```

## Documentation

For detailed documentation, please refer to the source code and comments in each file.

