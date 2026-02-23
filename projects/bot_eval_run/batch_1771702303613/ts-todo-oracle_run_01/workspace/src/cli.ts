import { argv } from 'process';
import TaskStore from './store';

const args = argv.slice(2);
const command = args[0];
const dataPath = args[args.length - 1];
const taskStore = new TaskStore(dataPath);

if (command === 'add') {
  const title = args.slice(1, -1).join(' ');
  const task = taskStore.add(title);
  console.log(JSON.stringify({ addedTask: task }));
} else if (command === 'list') {
  const tasks = taskStore.list();
  console.log(JSON.stringify({ tasks }));
} else if (command === 'done') {
  const id = args[1];
  taskStore.markAsDone(id);
  console.log(`Marked task with ID ${id} as done.`);
} else if (command === 'remove') {
  const id = args[1];
  taskStore.remove(id);
  console.log(`Removed task with ID ${id}.`);
} else if (command === '--help' || command === '-h') {
  console.log('Usage: node dist/cli.js <command> --data <path>');
  console.log('Commands: add, list, done, remove');
} else {
  console.error('Unknown command. Use --help for more information.');
}
