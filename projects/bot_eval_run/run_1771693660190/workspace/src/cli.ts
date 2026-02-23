import { argv } from 'process';
import TaskStore from './store';

const filePath = 'tasks.json';
const taskStore = new TaskStore(filePath);

if (argv[2] === '--help') {
  console.log('Usage: node dist/cli.js [command] [options]');
  console.log('Commands:');
  console.log('  add <title>   Add a new task');
  console.log('  list          List all tasks');
} else if (argv[2] === 'add') {
  const title = argv.slice(3).join(' ');
  if (!title) {
    console.error('Title is required for adding a task.');
    process.exit(1);
  }

  const task = taskStore.add(title);
  console.log(`Task added: ${task.title}`);
} else if (argv[2] === 'list') {
  const tasks = taskStore.list();
  tasks.forEach((task, index) => {
    console.log(`${index + 1}. [${task.done ? 'X' : ' '}] ${task.title}`);
  });
} else {
  console.error('Unknown command. Use --help for more information.');
  process.exit(1);
}