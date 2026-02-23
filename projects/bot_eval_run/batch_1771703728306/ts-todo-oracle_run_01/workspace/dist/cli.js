"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require('node:fs');
const store_1 = require("./store");
function help() {
    console.log(`Usage:
  node dist/cli.js add <title> --data <path>
  node dist/cli.js list --data <path>
  node dist/cli.js done <id> --data <path>
  node dist/cli.js remove <id> --data <path>`);
    process.exit(0);
}
const argv = process.argv.slice(2);
const cmd = argv[0];
let dataPath;
for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--data' && i + 1 < argv.length) {
        dataPath = argv[i + 1];
        break;
    }
}
if (!dataPath) {
    console.error('Missing --data option');
    process.exit(1);
}
const store = new store_1.TaskStore(dataPath);
switch (cmd) {
    case '--help':
        help();
        break;
    case 'list':
        const tasks = store.list();
        console.log(JSON.stringify({ ok: true, tasks }));
        break;
    case 'add':
        if (argv.length < 2) {
            console.error('Missing title for add command');
            process.exit(1);
        }
        const title = argv[1];
        const addedTask = store.add(title);
        console.log(JSON.stringify({ ok: true, task: addedTask }));
        break;
    case 'done':
        if (argv.length < 2) {
            console.error('Missing id for done command');
            process.exit(1);
        }
        const taskId = argv[1];
        const updatedTask = store.done(taskId);
        console.log(JSON.stringify({ ok: true, task: updatedTask }));
        break;
    case 'remove':
        if (argv.length < 2) {
            console.error('Missing id for remove command');
            process.exit(1);
        }
        const removeId = argv[1];
        const removedTask = store.remove(removeId);
        console.log(JSON.stringify({ ok: true, task: removedTask }));
        break;
    default:
        console.error('Unknown command');
        process.exit(1);
}
