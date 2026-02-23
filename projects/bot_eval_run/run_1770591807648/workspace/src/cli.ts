import * as fs from 'fs';
import * as path from 'path';
import { TaskStore } from './store';

const args = process.argv.slice(2);

function main() {
  const dataPath = args.find(arg => arg.startsWith('--data=')).split('=')[1];
  const store = new TaskStore(dataPath);

  switch (args[0]) {
    case 'list':
      console.log(JSON.stringify({ ok: true, tasks: store.list() }));
      break;
    case 'add':
      if (!args[1]) {
        console.error('Title is required for adding a task');
        process.exit(1);
      }
      const task = store.add(args[1]);
      console.log(JSON.stringify({ ok: true, task }));
      break;
    case 'done':
      if (!args[1]) {
        console.error('Task ID is required for marking a task as done');
        process.exit(1);
      }
      const doneTask = store.done(args[1]);
      console.log(JSON.stringify({ ok: true, task: doneTask }));
      break;
    case 'remove':
      if (!args[1]) {
        console.error('Task ID is required for removing a task');
        process.exit(1);
      }
      const removedTask = store.remove(args[1]);
      console.log(JSON.stringify({ ok: true, task: removedTask }));
      break;
    default:
      console.error('Unknown command');
      process.exit(1);
  }
}

main();
