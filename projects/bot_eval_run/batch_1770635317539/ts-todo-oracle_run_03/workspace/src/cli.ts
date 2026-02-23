declare const require: any;
declare const process: any;
const fs = require('node:fs');
const path = require('node:path');
import { TaskStore } from './store';

function help() {
  console.log(`Usage:
  node dist/cli.js list --data <path>
  node dist/cli.js add "Task title" --data <path>
  node dist/cli.js done <id> --data <path>
  node dist/cli.js remove <id> --data <path>`);
}

function parseArgs() {
  const args: { [key: string]: any } = {};
  process.argv.slice(2).forEach(arg => {
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=');
      args[key] = value || '';
    }
  });
  return args;
}

function main() {
  const args = parseArgs();
  if (args['help'] || process.argv.length < 3) {
    help();
    process.exit(0);
  }

  const command = process.argv[2];
  const dataPath = args['data'];

  if (!dataPath) {
    console.error('Missing --data option');
    process.exit(1);
  }

  const store = new TaskStore(dataPath);

  switch (command) {
    case 'list':
      console.log(JSON.stringify({ ok: true, tasks: store.list() }));
      break;
    case 'add':
      if (!args['_'][0]) {
        console.error('Missing task title');
        process.exit(1);
      }
      const newTask = store.add(args['_'][0]);
      console.log(JSON.stringify({ ok: true, task: newTask }));
      break;
    case 'done':
      if (!args['_'][0]) {
        console.error('Missing task id');
        process.exit(1);
      }
      const doneTask = store.done(args['_'][0]);
      if (doneTask) {
        console.log(JSON.stringify({ ok: true, task: doneTask }));
      } else {
        console.error('Task not found');
        process.exit(1);
      }
      break;
    case 'remove':
      if (!args['_'][0]) {
        console.error('Missing task id');
        process.exit(1);
      }
      const removedTask = store.remove(args['_'][0]);
      if (removedTask) {
        console.log(JSON.stringify({ ok: true, task: removedTask }));
      } else {
        console.error('Task not found');
        process.exit(1);
      }
      break;
    default:
      help();
      process.exit(1);
  }
}

main();