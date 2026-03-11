declare const process: any;
declare const require: any;
const fs = require("node:fs");
import { TaskStore } from './store';

const argv = process.argv.slice(2);
const cmd = argv[0];
const dataPath = argv.find(arg => arg.startsWith('--data'));
const filePath = dataPath ? dataPath.split('=')[1] : '';

if (!filePath) {
  console.error('--data <path> is required');
  process.exit(1);
}

const store = new TaskStore(filePath);

switch (cmd) {
  case 'list':
    const tasks = store.list();
    console.log(JSON.stringify({ ok: true, tasks: tasks }));
    break;
  case 'add':
    if (argv.length < 2) {
      console.error('Usage: add <title>');
      process.exit(1);
    }
    const title = argv[1];
    const task = store.add(title);
    console.log(JSON.stringify({ ok: true, task: task }));
    break;
  case 'done':
    if (argv.length < 2) {
      console.error('Usage: done <id>');
      process.exit(1);
    }
    const id = argv[1];
    const doneTask = store.done(id);
    if (doneTask) {
      console.log(JSON.stringify({ ok: true, task: doneTask }));
    } else {
      console.log(JSON.stringify({ ok: false, message: 'Task not found' }));
    }
    break;
  case 'remove':
    if (argv.length < 2) {
      console.error('Usage: remove <id>');
      process.exit(1);
    }
    const removeId = argv[1];
    const removedTask = store.remove(removeId);
    if (removedTask) {
      console.log(JSON.stringify({ ok: true, task: removedTask }));
    } else {
      console.log(JSON.stringify({ ok: false, message: 'Task not found' }));
    }
    break;
  default:
    console.error('Unknown command');
    process.exit(1);
}