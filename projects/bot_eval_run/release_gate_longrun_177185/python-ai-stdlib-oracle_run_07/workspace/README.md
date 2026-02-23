mini_ai
=========

A simple character-level Markov chain generator implemented in Python without any external dependencies.

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
- `--seed`: Optional seed string for deterministic generation.
- `--random-seed`: Optional random seed for reproducibility.

## Example

```bash
# Train a model with order 2
python -m mini_ai.cli train --input input.txt --model-out model.json --order 2

# Generate text of length 10 using the trained model
python -m mini_ai.cli generate --model model.json --length 10
```
