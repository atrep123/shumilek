# Task Manager CLI

## Usage

### Add a task
```bash
node dist/cli.js add "Buy milk" --data tasks.json
```

### List all tasks
```bash
node dist/cli.js list --data tasks.json
```

### Mark a task as done
```bash
node dist/cli.js done <id> --data tasks.json
```

### Remove a task
```bash
node dist/cli.js remove <id> --data tasks.json
```
