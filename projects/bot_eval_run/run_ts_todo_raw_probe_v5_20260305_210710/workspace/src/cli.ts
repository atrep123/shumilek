declare const process: any;
declare const require: any;
import { TaskStore } from './store';
const fs = require("node:fs");
import readline from 'node:readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function prompt(question: string): Promise<string> {
  return new Promise(resolve => {
    rl.question(question, resolve);
  });
}

async function main() {
  const filePath = await prompt('Enter the data file path: ');
  const taskStore = new TaskStore(filePath);

  while (true) {
    const command = await prompt('Enter a command (add, list, done, remove, exit): ');

    switch (command) {
      case 'add':
        const title = await prompt('Enter the task title: ');
        taskStore.add(title);
        console.log('Task added.');
        break;
      case 'list':
        console.log(taskStore.list());
        break;
      case 'done':
        const id = await prompt('Enter the task id: ');
        const task = taskStore.done(id);
        if (task) {
          console.log('Task marked as done:', task);
        } else {
          console.log('Task not found.');
        }
        break;
      case 'remove':
        const taskId = await prompt('Enter the task id: ');
        const success = taskStore.remove(taskId);
        if (success) {
          console.log('Task removed.');
        } else {
          console.log('Task not found.');
        }
        break;
      case 'exit':
        rl.close();
        return;
      default:
        console.log('Unknown command.');
    }
  }
}

main();
