# Todo CLI Application

This is a simple command-line interface (CLI) application for managing tasks. It allows you to add, list, mark as done, and remove tasks.

## Usage

### Add a Task
```bash
node dist/cli.js add "Task Title" --data path/to/tasks.json
```

### List Tasks
```bash
node dist/cli.js list --data path/to/tasks.json
```

### Mark a Task as Done
```bash
node dist/cli.js done <taskId> --data path/to/tasks.json
```

### Remove a Task
```bash
node dist/cli.js remove <taskId> --data path/to/tasks.json
```

## Help
To see the help information, use:
```bash
node dist/cli.js --help
```
