mini_ai
=========

A simple character-level Markov chain generator implemented in Python without external dependencies.

Installation
------------
No installation is required as this project uses only the standard Python library.

Usage
-----

### Training a Model
```bash
python -m mini_ai.cli train --input <path> --model-out <path> --order <int>
```

### Generating Text
```bash
python -m mini_ai.cli generate --model <path> --length <int> [--seed <str>] [--random-seed <int>]
```
