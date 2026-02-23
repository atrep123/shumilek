# Task Manager CLI

## Usage

- `add <title> --data <path>`: Add a new task.
- `list --data <path>`: List all tasks.
- `done <id> --data <path>`: Mark a task as done.
- `remove <id> --data <path>`: Remove a task.

## Example Commands

```bash
node dist/cli.js add "Buy milk" --data ./tasks.json
node dist/cli.js list --data ./tasks.json
node dist/cli.js done <task-id> --data ./tasks.json
node dist/cli.js remove <task-id> --data ./tasks.json
```
