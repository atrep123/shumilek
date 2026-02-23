import { TaskStore } from './store';
import process from 'node:process';
import fs from 'node:fs';
const argv = process.argv.slice(2);
let cmd = argv[0];
if (cmd === '--help') {
  console.log('Usage: todo <command> [options]');
  console.log('Commands:
  add <title> --data <path>    Add a new task
  list --data <path>        List all tasks
  done <id> --data <path>    Mark a task as done
  remove <id> --data <path>  Remove a task');
  process.exit(0);
}
cmd = cmd.replace(/^-+/, '');
const dataPath = argv.find(arg => arg.startsWith('--data')).split('=')[1];
const args = argv.filter(arg => !arg.startsWith('--data'));
switch (cmd) {
case 'add':
  const title = args[0].replace(/^['"](.*?)['"]$/, '$1');
  const store = new TaskStore(dataPath);
  const task = store.add(title);
  console.log({ ok: true, task });
  break;
case 'list':
  const storeList = new TaskStore(dataPath);
  const tasks = storeList.list();
  console.log({ ok: true, tasks });
  break;
case 'done':
  const id = args[0];
  const storeDone = new TaskStore(dataPath);
  const task = storeDone.done(id);
  if (task) {
    console.log({ ok: true, task });
  } else {
    console.log({ ok: false, message: 'Task not found' });
  }
  break;
case 'remove':
  const id = args[0];
  const storeRemove = new TaskStore(dataPath);
  const task = storeRemove.remove(id);
  if (task) {
    console.log({ ok: true, task });
  } else {
    console.log({ ok: false, message: 'Task not found' });
  }
  break;
default:
  console.error('Unknown command:', cmd);
  process.exit(1);
}
