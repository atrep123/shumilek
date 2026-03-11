# mini_ai

This is a simple implementation of a character-level Markov chain generator using the n-gram model. The package includes a `MarkovChain` class for training and generating text, as well as a command-line interface for interacting with the model.

## Installation

To use this package, simply clone the repository and run the following commands:

```bash
python -m mini_ai.cli train --input <path> --model-out <path> --order <int>
python -m mini_ai.cli generate --model <path> --length <int> [--seed <str>] [--random-seed <int>]
```

## Usage

### Training a Model

To train a model, use the `train` subcommand:

```bash
python -m mini_ai.cli train --input <path> --model-out <path> --order <int>
```

This will read the input text from `<path>` and save the trained model to `<path>`.

### Generating Text

To generate text using a trained model, use the `generate` subcommand:

```bash
python -m mini_ai.cli generate --model <path> --length <int> [--seed <str>] [--random-seed <int>]
```

This will read the trained model from `<path>` and generate text of length `<int>`, optionally starting with a given `seed` and using a specific `random_seed` for reproducibility.
