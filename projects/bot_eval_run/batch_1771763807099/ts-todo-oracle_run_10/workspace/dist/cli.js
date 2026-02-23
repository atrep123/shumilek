"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require('node:fs');
const crypto = require('node:crypto');
const store_1 = require("./store");
function help() {
    console.log(`Usage:
  add <title> --data <path>
  list --data <path>
  done <id> --data <path>
  remove <id> --data <path>`);
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
if (!dataPath && cmd !== '--help') {
    console.error('Missing --data option');
    process.exit(1);
}
const store = new store_1.TaskStore(dataPath || '');
switch (cmd) {
    case 'list':
        const tasks = store.list();
        console.log(JSON.stringify({ ok: true, tasks }));
        break;
    case 'add':
        if (!argv[1]) {
            console.error('Missing title for add command');
            process.exit(1);
        }
        const addedTask = store.add(argv[1]);
        console.log(JSON.stringify({ ok: true, task: addedTask }));
        break;
    case 'done':
        if (!argv[1]) {
            console.error('Missing id for done command');
            process.exit(1);
        }
        const doneTask = store.done(argv[1]);
        console.log(JSON.stringify({ ok: true, task: doneTask }));
        break;
    case 'remove':
        if (!argv[1]) {
            console.error('Missing id for remove command');
            process.exit(1);
        }
        const removedTask = store.remove(argv[1]);
        console.log(JSON.stringify({ ok: true, task: removedTask }));
        break;
    case '--help':
        help();
        break;
    default:
        console.error('Unknown command');
        process.exit(1);
}
