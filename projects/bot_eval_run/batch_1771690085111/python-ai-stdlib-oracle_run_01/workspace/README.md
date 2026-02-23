mini_ai
=========

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
