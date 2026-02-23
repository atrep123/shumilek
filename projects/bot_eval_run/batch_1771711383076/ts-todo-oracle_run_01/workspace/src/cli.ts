// src/cli.ts

const fs = require('node:fs');
const path = require('node:path');
const { TaskStore } = require('./store');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const [key, value] = argv[i].slice(2).split('=');
      args[key] = value || true;
    }
  }
  return args;
}

function help() {
  console.log(`Usage:
  list --data <path>
  add <title> --data <path>
  done <id> --data <path>
  remove <id> --data <path>`);
  process.exit(0);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help')) help();

  const args = parseArgs(argv);
  const cmd = argv[0];
  const dataPath = args.data;

  if (!dataPath) {
    console.error('Missing --data argument');
    process.exit(1);
  }

  const store = new TaskStore(dataPath);

  try {
    switch (cmd) {
      case 'list':
        const tasks = store.list();
        console.log(JSON.stringify({ ok: true, tasks }));
        break;
      case 'add':
        if (!argv[1]) throw new Error('Missing title');
        const task = store.add(argv[1]);
        console.log(JSON.stringify({ ok: true, task }));
        break;
      case 'done':
        if (!argv[1]) throw new Error('Missing id');
        const doneTask = store.done(argv[1]);
        console.log(JSON.stringify({ ok: true, task: doneTask }));
        break;
      case 'remove':
        if (!argv[1]) throw new Error('Missing id');
        const removedTask = store.remove(argv[1]);
        console.log(JSON.stringify({ ok: true, task: removedTask }));
        break;
      default:
        help();
    }
  } catch (error: any) {
    console.error(error.message);
    process.exit(1);
  }
}

main();