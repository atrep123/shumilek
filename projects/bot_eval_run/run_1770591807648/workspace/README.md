# Todo List CLI

This is a simple command-line interface for managing a todo list.

## Usage

### Add Task
```sh
todo add "Buy milk" --data ./tasks.json
```

### List Tasks
```sh
todo list --data ./tasks.json
```

### Mark Task as Done
```sh
todo done <task-id> --data ./tasks.json
```

### Remove Task
```sh
todo remove <task-id> --data ./tasks.json
```
