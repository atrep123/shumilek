declare const require: any;
declare const process: any;

const fs = require('node:fs');
const path = require('node:path');

import { TaskStore } from './store';

function parseArgs(argv: string[]): { cmd: string, args: string[], options: Record<string, string> } {
  const args: string[] = [];
  const options: Record<string, string> = {};
  let currentOption = '';

  for (const arg of argv) {
    if (arg.startsWith('--')) {
      currentOption = arg.slice(2);
      options[currentOption] = '';
    } else if (currentOption) {
      options[currentOption] = arg;
      currentOption = '';
    } else {
      args.push(arg);
    }
  }

  return { cmd: args[0], args: args.slice(1), options };
}

function help() {
  console.log(`
Usage:
  node dist/cli.js add <title> --data <path>
  node dist/cli.js list --data <path>
  node dist/cli.js done <id> --data <path>
  node dist/cli.js remove <id> --data <path>
`);
  process.exit(0);
}

async function main() {
  const { cmd, args, options } = parseArgs(process.argv.slice(2));

  if (cmd === '--help' || process.argv.slice(2).includes('--help')) {
    help();
  }

  if (!options.data) {
    console.error('Error: --data option is required');
    process.exit(1);
  }

  const store = new TaskStore(options.data);

  try {
    switch (cmd) {
      case 'list':
        const tasks = store.list();
        console.log(JSON.stringify({ ok: true, tasks }));
        break;
      case 'add':
        if (!args[0]) {
          throw new Error('Title is required');
        }
        const task = store.add(args[0]);
        console.log(JSON.stringify({ ok: true, task }));
        break;
      case 'done':
        if (!args[0]) {
          throw new Error('ID is required');
        }
        const doneTask = store.done(args[0]);
        console.log(JSON.stringify({ ok: true, task: doneTask }));
        break;
      case 'remove':
        if (!args[0]) {
          throw new Error('ID is required');
        }
        const removedTask = store.remove(args[0]);
        console.log(JSON.stringify({ ok: true, task: removedTask }));
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
