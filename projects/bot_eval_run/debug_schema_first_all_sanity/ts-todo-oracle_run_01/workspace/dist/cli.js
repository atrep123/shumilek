"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require('node:fs');
const crypto = require('node:crypto');
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
  node dist/cli.js remove <id> --data <path>
`);
    process.exit(0);
}
const store = new store_1.TaskStore(dataPath);
try {
    switch (cmd) {
        case 'list':
            const tasks = store.list();
            console.log(JSON.stringify({ ok: true, tasks }, null, 2));
            break;
        case 'add':
            if (!argv[1])
                throw new Error('Title is required for add command');
            const addedTask = store.add(argv[1]);
            console.log(JSON.stringify({ ok: true, task: addedTask }, null, 2));
            break;
        case 'done':
            if (!argv[1])
                throw new Error('ID is required for done command');
            const completedTask = store.done(argv[1]);
            console.log(JSON.stringify({ ok: true, task: completedTask }, null, 2));
            break;
        case 'remove':
            if (!argv[1])
                throw new Error('ID is required for remove command');
            const removedTask = store.remove(argv[1]);
            console.log(JSON.stringify({ ok: true, task: removedTask }, null, 2));
            break;
        default:
            throw new Error(`Unknown command: ${cmd}`);
    }
}
catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exit(1);
}
