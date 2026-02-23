"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require('node:fs');
const store_1 = require("./store");
function help() {
    console.log(`Usage:
- Add task: node dist/cli.js add "Buy milk" --data tasks.json
- List tasks: node dist/cli.js list --data tasks.json
- Mark task as done: node dist/cli.js done <id> --data tasks.json
- Remove task: node dist/cli.js remove <id> --data tasks.json`);
    process.exit(0);
}
function main() {
    const argv = process.argv.slice(2);
    if (argv.includes('--help'))
        help();
    const cmd = argv[0];
    let dataPath = 'tasks.json';
    const dataIndex = argv.indexOf('--data');
    if (dataIndex > -1 && dataIndex < argv.length - 1) {
        dataPath = argv[dataIndex + 1];
    }
    const store = new store_1.TaskStore(dataPath);
    try {
        switch (cmd) {
            case 'list':
                console.log(JSON.stringify({ ok: true, tasks: store.list() }));
                break;
            case 'add':
                if (!argv[1])
                    throw new Error('Title is required');
                const task = store.add(argv[1]);
                console.log(JSON.stringify({ ok: true, task }));
                break;
            case 'done':
                if (!argv[1])
                    throw new Error('ID is required');
                const doneTask = store.done(argv[1]);
                console.log(JSON.stringify({ ok: true, task: doneTask }));
                break;
            case 'remove':
                if (!argv[1])
                    throw new Error('ID is required');
                const removedTask = store.remove(argv[1]);
                console.log(JSON.stringify({ ok: true, task: removedTask }));
                break;
            default:
                throw new Error(`Unknown command: ${cmd}`);
        }
    }
    catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}
main();
