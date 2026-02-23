# Mini AI Project

This is a simple character-level Markov chain generator implemented in Python.

## Features
- Uses only standard Python libraries (no numpy, pandas, sklearn, torch, tensorflow, requests).
- Structured project with `mini_ai/` for the code and `tests/` for unit tests.
- CLI to train and generate text from a trained model.

## Installation
To install dependencies, run:
```bash
pip install -r requirements.txt
```

## Usage
### Training
Train the model using a text file:
```bash
python -m mini_ai.cli train --input data.txt
```

### Generating Text
Generate text from the trained model:
```bash
python -m mini_ai.cli generate --model checkpoints/latest.pth
```

## Project Structure
- `mini_ai/__init__.py`: Initializes the model.
- `mini_ai/trainer.py`: Contains the logic for training the model.
- `mini_ai/generator.py`: Contains the logic for generating text based on the trained model.
- `tests/test_model.py`: Unit tests for the model and CLI commands.

## Contributing
Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

## License
[MIT](https://choosealicense.com/licenses/mit/)