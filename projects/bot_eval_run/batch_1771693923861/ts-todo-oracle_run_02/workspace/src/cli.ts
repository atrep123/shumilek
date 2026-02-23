import { program } from 'commander';
import TaskStore from './store';

const taskStore = new TaskStore('tasks.json');

program
  .name('task-cli')
  .description('A simple CLI for managing tasks.')
  .version('1.0.0');

program
  .command('list')
  .description('List all tasks.')
  .action(() => {
    const tasks = taskStore.list();
    console.log(tasks);
  });

program
  .command('add <title>')
  .description('Add a new task.')
  .action((title) => {
    const task = taskStore.add(title);
    console.log(`Task added: ${task.title}`);
  });

program
  .command('update <id> <title>')
  .description('Update an existing task.')
  .action((id, title) => {
    const updatedTask = taskStore.update(id, { title });
    if (updatedTask) {
      console.log(`Task updated: ${updatedTask.title}`);
    } else {
      console.log('Task not found.');
    }
  });

program
  .command('remove <id>')
  .description('Remove a task.')
  .action((id) => {
    if (taskStore.remove(id)) {
      console.log('Task removed.');
    } else {
      console.log('Task not found.');
    }
  });

program.parse();