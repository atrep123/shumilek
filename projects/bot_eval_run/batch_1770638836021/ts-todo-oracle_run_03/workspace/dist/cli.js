"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require('node:fs');
const store_1 = require("./store");
const argv = process.argv.slice(2);
const cmd = argv[0];
const dataPathIndex = argv.indexOf('--data') + 1;
const dataPath = dataPathIndex > 0 ? argv[dataPathIndex] : 'tasks.json';
if (cmd === '--help' || !cmd) {
    console.log(`Usage:
  node dist/cli.js add <title> --data <path>
  node dist/cli.js list --data <path>
  node dist/cli.js done <id> --data <path>
  node dist/cli.js remove <id> --data <path>`);
    process.exit(0);
}
const store = new store_1.TaskStore(dataPath);
try {
    switch (cmd) {
        case 'list':
            console.log(JSON.stringify({ ok: true, tasks: store.list() }));
            break;
        case 'add':
            const title = argv[1];
            if (!title)
                throw new Error('Title is required');
            console.log(JSON.stringify({ ok: true, task: store.add(title) }));
            break;
        case 'done':
            const doneId = argv[1];
            if (!doneId)
                throw new Error('ID is required');
            console.log(JSON.stringify({ ok: true, task: store.done(doneId) }));
            break;
        case 'remove':
            const removeId = argv[1];
            if (!removeId)
                throw new Error('ID is required');
            console.log(JSON.stringify({ ok: true, task: store.remove(removeId) }));
            break;
        default:
            console.error(`Unknown command: ${cmd}`);
            process.exit(1);
    }
}
catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message }));
    process.exit(1);
}
