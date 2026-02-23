"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require('node:fs');
const path = require('node:path');
const store_1 = require("./store");
function help() {
    console.log(`Usage:
- List tasks: node dist/cli.js list --data <path>
- Add task: node dist/cli.js add <title> --data <path>
- Mark task as done: node dist/cli.js done <id> --data <path>
- Remove task: node dist/cli.js remove <id> --data <path>`);
    process.exit(0);
}
function main() {
    const args = process.argv.slice(2);
    if (args.includes('--help'))
        help();
    const dataPathIndex = args.indexOf('--data');
    if (dataPathIndex === -1) {
        console.error('Missing --data <path>');
        process.exit(1);
    }
    const dataPath = path.resolve(args[dataPathIndex + 1]);
    const store = new store_1.TaskStore(dataPath);
    switch (args[0]) {
        case 'list':
            console.log(JSON.stringify({ ok: true, tasks: store.list() }));
            break;
        case 'add':
            if (!args[1]) {
                console.error('Missing <title>');
                process.exit(1);
            }
            const task = store.add(args[1]);
            console.log(JSON.stringify({ ok: true, task }));
            break;
        case 'done':
            if (!args[1]) {
                console.error('Missing <id>');
                process.exit(1);
            }
            const doneTask = store.done(args[1]);
            console.log(JSON.stringify({ ok: true, task: doneTask }));
            break;
        case 'remove':
            if (!args[1]) {
                console.error('Missing <id>');
                process.exit(1);
            }
            const removedTask = store.remove(args[1]);
            console.log(JSON.stringify({ ok: true, task: removedTask }));
            break;
        default:
            help();
    }
}
main();
