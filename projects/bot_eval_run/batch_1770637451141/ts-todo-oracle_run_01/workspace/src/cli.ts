// src/cli.ts

declare const require: any;
const fs = require('node:fs');
const process = require('process');
const { TaskStore } = require('./store.js');

function help() {
  console.log(`Usage:
  list --data <path>
  add <title> --data <path>
  done <id> --data <path>
  remove <id> --data <path>`);
  process.exit(0);
}

if (process.argv.length < 3) {
  help();
}

const command = process.argv[2];
const args: { [key: string]: string } = {};
for (let i = 3; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg.startsWith('--')) {
    const key = arg.slice(2);
    const value = process.argv[++i];
    args[key] = value;
  }
}

if (!args.data) {
  console.error('Missing --data argument');
  process.exit(1);
}

const store = new TaskStore(args.data);

switch (command) {
  case 'list':
    try {
      const tasks = store.list();
      console.log(JSON.stringify({ ok: true, tasks }, null, 2));
    } catch (error) {
      console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
      process.exit(1);
    }
    break;

  case 'add':
    if (!args.title) {
      console.error('Missing title argument');
      process.exit(1);
    }
    try {
      const task = store.add(args.title);
      console.log(JSON.stringify({ ok: true, task }, null, 2));
    } catch (error) {
      console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
      process.exit(1);
    }
    break;

  case 'done':
    if (!args.id) {
      console.error('Missing id argument');
      process.exit(1);
    }
    try {
      const task = store.done(args.id);
      console.log(JSON.stringify({ ok: true, task }, null, 2));
    } catch (error) {
      console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
      process.exit(1);
    }
    break;

  case 'remove':
    if (!args.id) {
      console.error('Missing id argument');
      process.exit(1);
    }
    try {
      const task = store.remove(args.id);
      console.log(JSON.stringify({ ok: true, task }, null, 2));
    } catch (error) {
      console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
      process.exit(1);
    }
    break;

  case '--help':
    help();
    break;

  default:
    console.error(`Unknown command: ${command}`);
    process.exit(1);
}
