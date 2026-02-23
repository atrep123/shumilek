# mini_ai
This is a simple character-level Markov chain generator implemented in Python.

## Usage

### Training the model
```bash
python -m mini_ai.cli train --input <path> --model-out <path> --order <int>
```

### Generating text
```bash
python -m mini_ai.cli generate --model <path> --length <int> [--seed <str>] [--random-seed <int>]
```

