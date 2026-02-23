# Task Manager CLI

This is a simple task manager CLI built using TypeScript.

## Usage

### Add a new task
```sh
task-manager add "Buy milk" --data ./tasks.json
```

### List all tasks
```sh
task-manager list --data ./tasks.json
```

### Mark a task as done
```sh
task-manager done <task_id> --data ./tasks.json
```

### Remove a task
```sh
task-manager remove <task_id> --data ./tasks.json
```
