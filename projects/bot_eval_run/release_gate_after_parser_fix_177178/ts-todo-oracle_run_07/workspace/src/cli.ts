declare const require: any;
declare const process: any;
const fs = require("node:fs");
const crypto = require("node:crypto");

import { TaskStore } from './store';

function parseArgs() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  let dataPath = '';
  let titleOrId = '';

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--data') {
      dataPath = args[i + 1];
      i++;
    } else {
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

async function main() {
  const { cmd, dataPath, titleOrId } = parseArgs();

  if (cmd === '--help') {
    help();
  }

  if (!dataPath) {
    console.error('Missing --data <path>');
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
        if (!titleOrId) {
          console.error('Missing title for add command');
          process.exit(1);
        }
        const addedTask = store.add(titleOrId);
        console.log(JSON.stringify({ ok: true, task: addedTask }));
        break;
      case 'done':
        if (!titleOrId) {
          console.error('Missing id for done command');
          process.exit(1);
        }
        const doneTask = store.done(titleOrId);
        console.log(JSON.stringify({ ok: true, task: doneTask }));
        break;
      case 'remove':
        if (!titleOrId) {
          console.error('Missing id for remove command');
          process.exit(1);
        }
        const removedTask = store.remove(titleOrId);
        console.log(JSON.stringify({ ok: true, task: removedTask }));
        break;
      default:
        console.error(`Unknown command: ${cmd}`);
        process.exit(1);
    }
  } catch (error: any) {
    console.error(JSON.stringify({ ok: false, error: error.message }));
    process.exit(1);
  }
}

main();