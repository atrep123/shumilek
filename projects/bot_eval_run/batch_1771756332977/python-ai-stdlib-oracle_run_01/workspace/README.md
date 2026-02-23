# mini_ai

This is a simple implementation of a character-level Markov chain generator using Python's standard library. The package includes a `MarkovChain` class for training and generating text, as well as a command-line interface for interacting with the model.

## Installation

No installation is required as this project uses only Python's standard library.

## Usage

### Training a Model

To train a model, use the following command:

```bash
python -m mini_ai.cli train --input <path> --model-out <path> --order <int>
```

- `--input`: Path to the input text file.
- `--model-out`: Path where the trained model will be saved as a JSON file.
- `--order`: Order of the Markov chain (integer).

### Generating Text

To generate text using a trained model, use the following command:

```bash
python -m mini_ai.cli generate --model <path> --length <int> [--seed <str>] [--random-seed <int>]
```

- `--model`: Path to the trained model JSON file.
- `--length`: Length of the generated text (integer).
- `--seed`: Optional seed string for deterministic generation.
- `--random-seed`: Optional random seed for reproducibility.
