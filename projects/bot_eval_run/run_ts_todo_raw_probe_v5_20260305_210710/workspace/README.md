## Todo List CLI

This is a simple command-line interface for managing a todo list. It supports adding, listing, marking as done, and removing tasks.

### Usage

- `add <title>`: Add a new task with the given title.
- `list --data <path>`: List all tasks from the specified data file.
- `done <id>`: Mark a task as done by its ID.
- `remove <id>`: Remove a task by its ID.

### Example

```sh
# Add a new task
add "Buy milk" --data ./data/tasks.json

# List all tasks
list --data ./data/tasks.json

# Mark a task as done
done 1234-5678-9012-3456 --data ./data/tasks.json

# Remove a task
remove 1234-5678-9012-3456 --data ./data/tasks.json
```
