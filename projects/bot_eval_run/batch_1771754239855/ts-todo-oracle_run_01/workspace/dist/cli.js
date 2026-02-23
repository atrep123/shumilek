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
    console.error('Missing --data path');
    process.exit(1);
}
const store = new store_1.TaskStore(dataPath || '');
switch (cmd) {
    case 'add':
        if (argv.length < 2) {
            console.error('Missing title for add command');
            process.exit(1);
        }
        const title = argv[1];
        try {
            const task = store.add(title);
            console.log(JSON.stringify({ ok: true, task }));
        }
        catch (error) {
            console.error(JSON.stringify({ ok: false, error: error.message }));
            process.exit(1);
        }
        break;
    case 'list':
        try {
            const tasks = store.list();
            console.log(JSON.stringify({ ok: true, tasks }));
        }
        catch (error) {
            console.error(JSON.stringify({ ok: false, error: error.message }));
            process.exit(1);
        }
        break;
    case 'done':
        if (argv.length < 2) {
            console.error('Missing id for done command');
            process.exit(1);
        }
        const id = argv[1];
        try {
            const task = store.done(id);
            console.log(JSON.stringify({ ok: true, task }));
        }
        catch (error) {
            console.error(JSON.stringify({ ok: false, error: error.message }));
            process.exit(1);
        }
        break;
    case 'remove':
        if (argv.length < 2) {
            console.error('Missing id for remove command');
            process.exit(1);
        }
        const removeId = argv[1];
        try {
            const task = store.remove(removeId);
            console.log(JSON.stringify({ ok: true, task }));
        }
        catch (error) {
            console.error(JSON.stringify({ ok: false, error: error.message }));
            process.exit(1);
        }
        break;
    case '--help':
        help();
        break;
    default:
        console.error('Unknown command');
        process.exit(1);
}
