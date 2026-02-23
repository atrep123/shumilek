# Mini AI Project

A simple character-level Markov chain generator implemented in Python without any external dependencies.

## Usage

### Train a model
```bash
python -m mini_ai.cli train <input_file> <model_file>
```

### Generate text
```bash
python -m mini_ai.cli generate <model_file> <output_length>
```

## Testing

Run tests using:
```bash
python -m unittest discover -v -s tests -p "test*.py"
```
