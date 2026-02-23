mini_ai

A simple character-level Markov chain generator implemented in Python without any external dependencies.

## Installation

No installation is required as this project uses only the standard Python library.

## Usage

### Training a Model

To train a model, use the `train` subcommand:

```bash
python -m mini_ai.cli train --input <path> --model-out <path> --order <int>
```

- `--input`: Path to the input text file.
- `--model-out`: Path where the trained model will be saved as a JSON file.
- `--order`: Order of the Markov chain (integer).

### Generating Text

To generate text using a trained model, use the `generate` subcommand:

```bash
python -m mini_ai.cli generate --model <path> --length <int> [--seed <str>] [--random-seed <int>]
```

- `--model`: Path to the trained model JSON file.
- `--length`: Length of the generated text (integer).
- `--seed`: Optional seed string to start the generation.
- `--random-seed`: Optional random seed for reproducibility.
