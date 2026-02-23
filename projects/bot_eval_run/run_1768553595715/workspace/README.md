# Mini AI Project

This is a simple character-level Markov chain generator built as part of a Python project without using any external libraries like numpy, pandas, sklearn, torch, tensorflow, or requests.

## Features
- Character-level Markov chain model for text generation.
- Command Line Interface (CLI) for training and generating text.

## Installation
No installation required, just run the script with Python.

## Usage
```sh
python -m mini_ai.cli train --input yourfile.txt
python -m mini_ai.cli generate --length 50
```

## CLI Commands
- `train`: Train the model on a given text file.
- `generate`: Generate text based on the trained model.

## Tests
To run tests, use:
```sh
python -m unittest discover -v -s tests -p "test*.py"
```
