declare const require: any;
declare const process: any;
const fs = require("node:fs");
import { TaskStore } from './store';

const argv = process.argv.slice(2);
const cmd = argv[0];
const dataPathIndex = argv.indexOf('--data');
const dataPath = dataPathIndex !== -1 ? argv[dataPathIndex + 1] : null;

if (cmd === '--help' || process.argv.slice(2).includes('--help')) {
  console.log(`Usage:
  node dist/cli.js add <title> --data <path>
  node dist/cli.js list --data <path>
  node dist/cli.js done <id> --data <path>
  node dist/cli.js remove <id> --data <path>`);
  process.exit(0);
}

if (!dataPath) {
  console.error('Missing --data option');
  process.exit(1);
}

const store = new TaskStore(dataPath as string);

switch (cmd) {
  case 'list':
    try {
      const tasks = store.list();
      console.log(JSON.stringify({ ok: true, tasks }));
    } catch (error: any) {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exit(1);
    }
    break;

  case 'add':
    if (!argv[1]) {
      console.error('Missing task title');
      process.exit(1);
    }
    try {
      const task = store.add(argv[1]);
      console.log(JSON.stringify({ ok: true, task }));
    } catch (error: any) {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exit(1);
    }
    break;

  case 'done':
    if (!argv[1]) {
      console.error('Missing task id');
      process.exit(1);
    }
    try {
      const task = store.done(argv[1]);
      console.log(JSON.stringify({ ok: true, task }));
    } catch (error: any) {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exit(1);
    }
    break;

  case 'remove':
    if (!argv[1]) {
      console.error('Missing task id');
      process.exit(1);
    }
    try {
      const task = store.remove(argv[1]);
      console.log(JSON.stringify({ ok: true, task }));
    } catch (error: any) {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exit(1);
    }
    break;

  default:
    console.error('Unknown command');
    process.exit(1);
}