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
  .command('done <id>')
  .description('Mark a task as done.')
  .action((id) => {
    try {
      const task = taskStore.done(id);
      console.log(`Task marked as done: ${task.title}`);
    } catch (error) {
      console.error(error.message);
    }
  });

program.parse();