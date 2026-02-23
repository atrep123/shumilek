"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const store_1 = require("./store");
const argv = process.argv.slice(2);
const cmd = argv[0];
const dataPathIndex = argv.indexOf('--data');
const dataPath = dataPathIndex !== -1 ? argv[dataPathIndex + 1] : null;
if (cmd === '--help') {
    console.log(`Usage:
  add <title> --data <path>
  list --data <path>
  done <id> --data <path>
  remove <id> --data <path>`);
    process.exit(0);
}
if (!dataPath) {
    console.error('Missing --data option');
    process.exit(1);
}
const store = new store_1.TaskStore(dataPath);
try {
    switch (cmd) {
        case 'list':
            const tasks = store.list();
            console.log(JSON.stringify({ ok: true, tasks }));
            break;
        case 'add':
            if (!argv[1]) {
                throw new Error('Missing title');
            }
            const addedTask = store.add(argv[1]);
            console.log(JSON.stringify({ ok: true, task: addedTask }));
            break;
        case 'done':
            if (!argv[1]) {
                throw new Error('Missing id');
            }
            const doneTask = store.done(argv[1]);
            console.log(JSON.stringify({ ok: true, task: doneTask }));
            break;
        case 'remove':
            if (!argv[1]) {
                throw new Error('Missing id');
            }
            const removedTask = store.remove(argv[1]);
            console.log(JSON.stringify({ ok: true, task: removedTask }));
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
