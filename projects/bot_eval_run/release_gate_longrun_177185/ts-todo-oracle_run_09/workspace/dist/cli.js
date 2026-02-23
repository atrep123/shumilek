"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require('node:fs');
const path = require('node:path');
const store_1 = require("./store");
function parseArgs() {
    const args = process.argv.slice(2);
    const cmd = args[0];
    let dataPath = '';
    let titleOrId = '';
    for (let i = 1; i < args.length; i++) {
        if (args[i] === '--data') {
            dataPath = args[i + 1];
            i++;
        }
        else {
            titleOrId = args[i];
        }
    }
    return { cmd, dataPath, titleOrId };
}
function help() {
    console.log(`Usage:
  node dist/cli.js add <title> --data <path>
  node dist/cli.js list --data <path>
  node dist/cli.js done <id> --data <path>
  node dist/cli.js remove <id> --data <path>`);
    process.exit(0);
}
function main() {
    const { cmd, dataPath, titleOrId } = parseArgs();
    if (cmd === '--help') {
        help();
    }
    if (!dataPath) {
        console.error('Missing --data <path>');
        process.exit(1);
    }
    const store = new store_1.TaskStore(dataPath);
    try {
        switch (cmd) {
            case 'list':
                console.log(JSON.stringify({ ok: true, tasks: store.list() }));
                break;
            case 'add':
                if (!titleOrId) {
                    throw new Error('Missing title');
                }
                console.log(JSON.stringify({ ok: true, task: store.add(titleOrId) }));
                break;
            case 'done':
                if (!titleOrId) {
                    throw new Error('Missing id');
                }
                console.log(JSON.stringify({ ok: true, task: store.done(titleOrId) }));
                break;
            case 'remove':
                if (!titleOrId) {
                    throw new Error('Missing id');
                }
                console.log(JSON.stringify({ ok: true, task: store.remove(titleOrId) }));
                break;
            default:
                help();
        }
    }
    catch (error) {
        console.error(JSON.stringify({ ok: false, error: error.message }));
        process.exit(1);
    }
}
main();
