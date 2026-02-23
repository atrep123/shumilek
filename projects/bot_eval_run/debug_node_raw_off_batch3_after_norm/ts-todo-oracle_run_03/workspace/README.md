# Task Manager CLI

## Usage

### Add a task
```sh
node dist/cli.js add "Buy milk" --data tasks.json
```

### List all tasks
```sh
node dist/cli.js list --data tasks.json
```

### Mark a task as done
```sh
node dist/cli.js done <id> --data tasks.json
```

### Remove a task
```sh
node dist/cli.js remove <id> --data tasks.json
```
