"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("node:fs");
const crypto = require("node:crypto");
const store_1 = require("./store");
const argv = process.argv.slice(2);
const cmd = argv[0];
const dataPathIndex = argv.indexOf('--data');
const dataPath = dataPathIndex !== -1 ? argv[dataPathIndex + 1] : null;
if (cmd === '--help' || !dataPath) {
    console.log(`Usage:
  node dist/cli.js add <title> --data <path>
  node dist/cli.js list --data <path>
  node dist/cli.js done <id> --data <path>
  node dist/cli.js remove <id> --data <path>`);
    process.exit(0);
}
const store = new store_1.TaskStore(dataPath);
try {
    let result;
    switch (cmd) {
        case 'list':
            result = { ok: true, tasks: store.list() };
            break;
        case 'add':
            const title = argv[1];
            if (!title)
                throw new Error('Title is required for add command');
            result = { ok: true, task: store.add(title) };
            break;
        case 'done':
            const idDone = argv[1];
            if (!idDone)
                throw new Error('ID is required for done command');
            result = { ok: true, task: store.done(idDone) };
            break;
        case 'remove':
            const idRemove = argv[1];
            if (!idRemove)
                throw new Error('ID is required for remove command');
            result = { ok: true, task: store.remove(idRemove) };
            break;
        default:
            throw new Error(`Unknown command: ${cmd}`);
    }
    console.log(JSON.stringify(result));
}
catch (error) {
    console.error({ ok: false, error: error.message });
}
