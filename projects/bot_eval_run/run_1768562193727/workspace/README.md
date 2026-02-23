# mini_ai
Character-level Markov chain generator using n-grams.

## Installation
No installation required, just clone the repository and run the scripts.

## Usage
### Train model
```bash
python -m mini_ai.cli train --input <path> --model-out <path> --order <int>
```
### Generate text
```bash
python -m mini_ai.cli generate --model <path> --length <int> [--seed <str>] [--random-seed <int>]
```
