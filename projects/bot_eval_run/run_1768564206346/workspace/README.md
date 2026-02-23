# mini_ai - Character-level Markov Chain Generator

This is a simple implementation of a character-level Markov chain generator using the standard Python library.

## Usage

### Training a Model

```bash
python -m mini_ai.cli train --input <path> --model-out <path> --order <int>
```

### Generating Text

```bash
python -m mini_ai.cli generate --model <path> --length <int> [--seed <str>] [--random-seed <int>]
```
