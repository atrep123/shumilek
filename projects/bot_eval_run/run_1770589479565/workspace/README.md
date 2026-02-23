# Todo List CLI

This is a simple command-line interface for managing a todo list.

## Usage

Add a task:
```sh
todo add 'Buy milk' --data ./data/tasks.json
```

List tasks:
```sh
todo list --data ./data/tasks.json
```

Mark a task as done:
```sh
todo done <task-id> --data ./data/tasks.json
```

Remove a task:
```sh
todo remove <task-id> --data ./data/tasks.json
```
