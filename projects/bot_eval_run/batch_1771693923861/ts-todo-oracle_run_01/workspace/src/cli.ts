declare const require: any;
declare const process: any;
const fs = require('node:fs');
const crypto = require('node:crypto');
import { TaskStore } from './store';

const args = process.argv.slice(2);
const command = args[0];
const filePath = 'tasks.json';
const taskStore = new TaskStore(filePath);

switch (command) {
  case '--help':
    console.log('Usage: node dist/cli.js [command] [options]');
    console.log('Commands:');
    console.log('  add <title>       Add a new task with the given title');
    console.log('  list              List all tasks');
    console.log('  done <id>         Mark a task as done by its ID');
    console.log('  remove <id>       Remove a task by its ID');
    break;

  case 'add':
    if (args.length < 2) {
      console.error('Error: Title is required for adding a new task.');
      process.exit(1);
    }
    const title = args.slice(1).join(' ');
    const task = taskStore.add(title);
    console.log(JSON.stringify(task));
    break;

  case 'list':
    const tasks = taskStore.list();
    console.log(JSON.stringify(tasks));
    break;

  case 'done':
    if (args.length < 2) {
      console.error('Error: Task ID is required to mark a task as done.');
      process.exit(1);
    }
    const taskId = args[1];
    try {
      taskStore.markDone(taskId);
      console.log(`Task with ID ${taskId} marked as done.`);
    } catch (error) {
      console.error(error.message);
    }
    break;

  case 'remove':
    if (args.length < 2) {
      console.error('Error: Task ID is required to remove a task.');
      process.exit(1);
    }
    const taskIdToRemove = args[1];
    try {
      taskStore.remove(taskIdToRemove);
      console.log(`Task with ID ${taskIdToRemove} removed.`);
    } catch (error) {
      console.error(error.message);
    }
    break;

  default:
    console.error('Error: Unknown command. Use --help to see available commands.');
    process.exit(1);
}
