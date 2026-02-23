"use strict";
const fs = require('node:fs');
const path = require('node:path');
const { TaskStore } = require('./store');
function showHelp() {
    console.log(`
Usage:
  add <title> --data <path>
  list --data <path>
  done <id> --data <path>
  remove <id> --data <path>
  --help
`);
    process.exit(0);
}
function parseArgs() {
    const args = process.argv.slice(2);
    let cmd = args[0];
    let dataPath = null;
    let titleOrId = null;
    for (let i = 1; i < args.length; i++) {
        if (args[i] === '--data' && i + 1 < args.length) {
            dataPath = args[i + 1];
            i++;
        }
        else if (!titleOrId) {
            titleOrId = args[i];
        }
    }
    return { cmd, dataPath, titleOrId };
}
function main() {
    const { cmd, dataPath, titleOrId } = parseArgs();
    if (cmd === '--help') {
        showHelp();
    }
    if (!dataPath) {
        console.error('Missing --data option');
        process.exit(1);
    }
    const store = new TaskStore(dataPath);
    try {
        switch (cmd) {
            case 'list':
                console.log(JSON.stringify({ ok: true, tasks: store.list() }));
                break;
            case 'add':
                if (!titleOrId)
                    throw new Error('Missing title');
                console.log(JSON.stringify({ ok: true, task: store.add(titleOrId) }));
                break;
            case 'done':
                if (!titleOrId)
                    throw new Error('Missing id');
                console.log(JSON.stringify({ ok: true, task: store.done(titleOrId) }));
                break;
            case 'remove':
                if (!titleOrId)
                    throw new Error('Missing id');
                console.log(JSON.stringify({ ok: true, task: store.remove(titleOrId) }));
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
}
main();
