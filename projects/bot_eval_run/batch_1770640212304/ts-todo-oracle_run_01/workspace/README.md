# Todo CLI

A simple command-line todo list application built using TypeScript.

## Usage

Add a new task:
```sh
todo add "Buy milk" --data ./tasks.json
```

List all tasks:
```sh
todo list --data ./tasks.json
```

Mark a task as done:
```sh
todo done <id> --data ./tasks.json
```

Remove a task:
```sh
todo remove <id> --data ./tasks.json
```
