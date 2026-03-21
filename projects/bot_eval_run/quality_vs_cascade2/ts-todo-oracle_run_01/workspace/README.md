# Todo CLI

This is a simple command line interface for managing tasks. It supports the following commands:

- `list --data <path>`: List all tasks from the JSON file.
- `add <title> --data <path>`: Add a new task with the given title.
- `done <id> --data <path>`: Mark a task as done.
- `remove <id> --data <path>`: Remove a task.

All commands require the `--data <path>` option to specify the JSON file where tasks are stored. If the file does not exist, it will be created when adding a task.

## Usage

```bash
node dist/cli.js list --data ./tasks.json
node dist/cli.js add "Buy milk" --data ./tasks.json
node dist/cli.js done <id> --data ./tasks.json
node dist/cli.js remove <id> --data ./tasks.json
```

All commands output a JSON object with an `ok` field and the relevant data. Errors are printed to stderr and result in a non-zero exit code.

## Example

```bash
$ node dist/cli.js list --data ./tasks.json
{ ok: true, tasks: [] }

$ node dist/cli.js add "Buy milk" --data ./tasks.json
{ ok: true, task: { id: '1a2b3c', title: 'Buy milk', done: false, createdAt: '2024-01-01T00:00:00.000Z' } }

$ node dist/cli.js done 1a2b3c --data ./tasks.json
{ ok: true, task: { id: '1a2b3c', title: 'Buy milk', done: true, createdAt: '2024-01-01T00:00:00.000Z', doneAt: '2024-01-01T00:00:01.000Z' } }

$ node dist/cli.js remove 1a2b3c --data ./tasks.json
{ ok: true, task: { id: '1a2b3c', title: 'Buy milk', done: true } }
```

## Notes

- The CLI uses only Node.js built-in modules (`fs`, `path`, `crypto`). No external dependencies are required.
- The `TaskStore` class handles all persistence logic and is used by the CLI.
- The project is compiled with TypeScript to `dist/` using the `tsconfig.json` configuration.
- Ensure you run `npm install` (though no dependencies are installed) and then `npx tsc` to compile before running the CLI.
