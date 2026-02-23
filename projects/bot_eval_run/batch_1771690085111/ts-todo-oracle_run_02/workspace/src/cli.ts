declare const require: any;
declare const process: any;

const fs = require('node:fs');
const path = require('node:path');

import { TaskStore } from './store';

function parseArgs() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  let dataPath = 'tasks.json';

  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--data' && i + 1 < argv.length) {
      dataPath = argv[i + 1];
      break;
    }
  }

  return { cmd, dataPath };
}

function help() {
  console.log(`Usage:
  node dist/cli.js add <title> --data <path>
  node dist/cli.js list --data <path>
  node dist/cli.js done <id> --data <path>
  node dist/cli.js remove <id> --data <path>`);
  process.exit(0);
}

async function main() {
  const { cmd, dataPath } = parseArgs();

  if (cmd === '--help') {
    help();
  }

  const store = new TaskStore(dataPath);

  try {
    switch (cmd) {
      case 'list':
        console.log(JSON.stringify({ ok: true, tasks: store.list() }));
        break;
      case 'add':
        if (!process.argv[3]) throw new Error('Title is required');
        const title = process.argv[3];
        console.log(JSON.stringify({ ok: true, task: store.add(title) }));
        break;
      case 'done':
        if (!process.argv[3]) throw new Error('ID is required');
        const idDone = process.argv[3];
        console.log(JSON.stringify({ ok: true, task: store.done(idDone) }));
        break;
      case 'remove':
        if (!process.argv[3]) throw new Error('ID is required');
        const idRemove = process.argv[3];
        console.log(JSON.stringify({ ok: true, task: store.remove(idRemove) }));
        break;
      default:
        help();
    }
  } catch (error: any) {
    console.error(JSON.stringify({ ok: false, error: error.message }));
    process.exit(1);
  }
}

main();