"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function help() {
    console.log(`Usage:
  add <title> --data <path>
  list --data <path>
  done <id> --data <path>
  remove <id> --data <path>`);
    process.exit(0);
}
const args = process.argv.slice(2);
if (args.length === 0 || args[0] === '--help') {
    help();
}
let command = args[0];
let dataPath;
let idOrTitle;
for (let i = 1; i < args.length; i++) {
    if (args[i] === '--data') {
        dataPath = args[i + 1];
        i++;
    }
    else {
        if (!idOrTitle) {
            idOrTitle = args[i];
        }
    }
}
if (!dataPath) {
    console.error('Missing --data option');
    process.exit(1);
}
const taskStore = new TaskStore(dataPath);
switch (command) {
    case 'add':
        if (!idOrTitle) {
            console.error('Missing title for add command');
            process.exit(1);
        }
        const addedTask = taskStore.add(idOrTitle);
        console.log(JSON.stringify({ ok: true, task: addedTask }, null, 2));
        break;
    case 'list':
        const tasks = taskStore.list();
        console.log(JSON.stringify({ ok: true, tasks: tasks }, null, 2));
        break;
    case 'done':
        if (!idOrTitle) {
            console.error('Missing id for done command');
            process.exit(1);
        }
        const updatedTask = taskStore.done(idOrTitle);
        console.log(JSON.stringify({ ok: true, task: updatedTask }, null, 2));
        break;
    case 'remove':
        if (!idOrTitle) {
            console.error('Missing id for remove command');
            process.exit(1);
        }
        const removedTask = taskStore.remove(idOrTitle);
        console.log(JSON.stringify({ ok: true, task: removedTask }, null, 2));
        break;
    default:
        help();
}
