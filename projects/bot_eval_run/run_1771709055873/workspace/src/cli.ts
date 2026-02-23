declare const require: any;
declare const process: any;
const fs = require('node:fs');
const crypto = require('node:crypto');
import { TaskStore } from './store';

const argv = process.argv.slice(2);
const cmd = argv[0];
const dataPathIndex = argv.indexOf('--data') + 1;
const dataPath = dataPathIndex > 0 ? argv[dataPathIndex] : null;

if (cmd === '--help' || !cmd) {
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

const store = new TaskStore(dataPath);

try {
  switch (cmd) {
    case 'list':
      const tasks = store.list();
      console.log(JSON.stringify({ ok: true, tasks }, null, 2));
      break;
    case 'add':
      if (!argv[1]) throw new Error('Missing title');
      const addedTask = store.add(argv[1]);
      console.log(JSON.stringify({ ok: true, task: addedTask }, null, 2));
      break;
    case 'done':
      if (!argv[1]) throw new Error('Missing id');
      const doneTask = store.done(argv[1]);
      console.log(JSON.stringify({ ok: true, task: doneTask }, null, 2));
      break;
    case 'remove':
      if (!argv[1]) throw new Error('Missing id');
      const removedTask = store.remove(argv[1]);
      console.log(JSON.stringify({ ok: true, task: removedTask }, null, 2));
      break;
    default:
      console.error(`Unknown command: ${cmd}`);
      process.exit(1);
  }
} catch (error: any) {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
}
