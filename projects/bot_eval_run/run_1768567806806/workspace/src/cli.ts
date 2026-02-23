// declare const require: any;
// declare const process: any;
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');
const path = require('node:path');
import { TaskStore } from './store';

function help() {
  console.log(`Usage:
  node dist/cli.js --help
  node dist/cli.js list --data <path>
  node dist/cli.js add <title> --data <path>
  node dist/cli.js done <id> --data <path>
  node dist/cli.js remove <id> --data <path>`);
}

function main() {
  if (process.argv[2] === '--help') {
    help();
    process.exit(0);
  }

  const dataPath = process.argv.find(arg => arg.startsWith('--data='))?.split('=')[1];
  if (!dataPath) {
    console.error('Missing --data option');
    process.exit(1);
  }

  const store = new TaskStore(dataPath);

  switch (process.argv[2]) {
    case 'list':
      console.log(JSON.stringify({ ok: true, tasks: store.list() }));
      break;
    case 'add':
      const titleIndex = process.argv.findIndex(arg => arg === '--data');
      const title = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : '';
      if (!title) {
        console.error('Missing task title');
        process.exit(1);
      }
      console.log(JSON.stringify({ ok: true, task: store.add(title) }));
      break;
    case 'done':
      const idDone = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : '';
      if (!idDone) {
        console.error('Missing task ID');
        process.exit(1);
      }
      console.log(JSON.stringify({ ok: true, task: store.done(idDone) }));
      break;
    case 'remove':
      const idRemove = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : '';
      if (!idRemove) {
        console.error('Missing task ID');
        process.exit(1);
      }
      console.log(JSON.stringify({ ok: true, task: store.remove(idRemove) }));
      break;
    default:
      help();
      process.exit(1);
  }
}

main();
