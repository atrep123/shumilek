
const fs = require('node:fs');
const crypto = require('node:crypto');

import { TaskStore } from './store';

function showHelp() {
  console.log(`Usage:
  add <title> --data <path>
  list --data <path>
  done <id> --data <path>
  remove <id> --data <path>
  --help`);
  process.exit(0);
}

function parseArgs() {
  const args = process.argv.slice(2);
  let cmd = args[0];
  let dataPath: string | null = null;
  let titleOrId: string | null = null;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--data' && i + 1 < args.length) {
      dataPath = args[i + 1];
      i++;
    } else if (!titleOrId) {
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
    console.error('Missing --data <path> argument');
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
        if (!titleOrId) {
          throw new Error('Missing title for add command');
        }
        const addedTask = store.add(titleOrId);
        console.log(JSON.stringify({ ok: true, task: addedTask }, null, 2));
        break;
      case 'done':
        if (!titleOrId) {
          throw new Error('Missing id for done command');
        }
        const doneTask = store.done(titleOrId);
        console.log(JSON.stringify({ ok: true, task: doneTask }, null, 2));
        break;
      case 'remove':
        if (!titleOrId) {
          throw new Error('Missing id for remove command');
        }
        const removedTask = store.remove(titleOrId);
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
}

main();