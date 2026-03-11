## Todo List CLI

This is a simple CLI tool for managing a todo list. It supports the following commands:

- `add <title>`: Add a new task with the given title.
- `list`: List all tasks.
- `done <id>`: Mark a task as done by its ID.
- `remove <id>`: Remove a task by its ID.

### Usage

To use the CLI, run:

```sh
node dist/cli.js add <title> --data <path>
node dist/cli.js list --data <path>
node dist/cli.js done <id> --data <path>
node dist/cli.js remove <id> --data <path>
```

Replace `<title>` and `<id>` with the appropriate values, and `<path>` with the path to the data file.

### Example

```sh
node dist/cli.js add Buy milk --data data/tasks.json
node dist/cli.js list --data data/tasks.json
node dist/cli.js done 12345 --data data/tasks.json
node dist/cli.js remove 12345 --data data/tasks.json
```

This will add a task, list all tasks, mark a task as done, and remove a task, respectively.

