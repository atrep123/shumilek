"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// declare const require: any;
// declare const process: any;
const module_1 = require("module");
const require = (0, module_1.createRequire)(import.meta.url);
const fs = require('node:fs');
const path = require('node:path');
const store_1 = require("./store");
function help() {
    console.log(`Usage:
  node dist/cli.js --help
  node dist/cli.js list --data <path>
  node dist/cli.js add <title> --data <path>
  node dist/cli.js done <id> --data <path>
  node dist/cli.js remove <id> --data <path>`);
}
function main() {
    var _a;
    if (process.argv[2] === '--help') {
        help();
        process.exit(0);
    }
    const dataPath = (_a = process.argv.find(arg => arg.startsWith('--data='))) === null || _a === void 0 ? void 0 : _a.split('=')[1];
    if (!dataPath) {
        console.error('Missing --data option');
        process.exit(1);
    }
    const store = new store_1.TaskStore(dataPath);
    switch (process.argv[2]) {
        case 'list':
            console.log(JSON.stringify({ ok: true, tasks: store.list() }));
            break;
        case 'add':
            const titleIndex = process.argv.findIndex(arg => arg === '--data');
            const title = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : '';
            if (!title) {
                console.error('Missing task title');
                process.exit(1);
            }
            console.log(JSON.stringify({ ok: true, task: store.add(title) }));
            break;
        case 'done':
            const idDone = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : '';
            if (!idDone) {
                console.error('Missing task ID');
                process.exit(1);
            }
            console.log(JSON.stringify({ ok: true, task: store.done(idDone) }));
            break;
        case 'remove':
            const idRemove = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : '';
            if (!idRemove) {
                console.error('Missing task ID');
                process.exit(1);
            }
            console.log(JSON.stringify({ ok: true, task: store.remove(idRemove) }));
            break;
        default:
            help();
            process.exit(1);
    }
}
main();
