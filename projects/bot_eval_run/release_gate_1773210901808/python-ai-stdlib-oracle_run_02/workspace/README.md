mini_ai

A simple character-level Markov chain generator implemented in Python.

## Usage

### Training a Model

```bash
python -m mini_ai.cli train --input <path> --model-out <path> --order <int>
```

### Generating Text

```bash
python -m mini_ai.cli generate --model <path> --length <int> [--seed <str>] [--random-seed <int>]
```

## Example

```bash
# Train a model
python -m mini_ai.cli train --input data.txt --model-out model.json --order 2

# Generate text
python -m mini_ai.cli generate --model model.json --length 100 --seed "a"
```

## Notes

- The `order` parameter specifies the order of the Markov chain.
- The `seed` parameter is optional and can be used to start the generation with a specific character.
- The `random_seed` parameter is optional and can be used to seed the random number generator for reproducibility.

