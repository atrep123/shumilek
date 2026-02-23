# Mini AI Project

This is a simple character-level Markov chain generator implemented in Python without using any external libraries like numpy, pandas, sklearn, torch, tensorflow, or requests.

## Features
- **Train the model on a text file**: Use `python -m mini_ai.cli train <input_file>` to train the model.
- **Generate text based on the trained model**: Use `python -m mini_ai.cli generate` to generate new text.

## Installation
1. Clone the repository: `git clone [repository_url]`
2. Navigate to the project directory: `cd mini_ai`
3. Install dependencies: `pip install .`

## Usage
- To train the model, run:
  ```bash
  python -m mini_ai.cli train <input_file>
  ```
- To generate text, run:
  ```bash
  python -m mini_ai.cli generate
  ```

## Tests
To run the tests, use the following command:
```bash
python -m unittest discover -s tests/
```

