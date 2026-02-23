import { program } from 'commander';
import TaskStore from './store';

const taskStore = new TaskStore('tasks.json');

program
  .name('task-cli')
  .description('A simple CLI for managing tasks.')
  .version('1.0.0');

program
  .command('add <title>')
  .description('Add a new task')
  .action((title) => {
    const task = taskStore.add(title);
    console.log(`Task added: ${task.title}`);
  });

program
  .command('list')
  .description('List all tasks')
  .action(() => {
    const tasks = taskStore.list();
    tasks.forEach(task => {
      console.log(`${task.id}: ${task.title} [${task.done ? 'Done' : 'Pending'}]`);
    });
  });

program
  .command('update <id> <title>')
  .description('Update a task')
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
  .description('Remove a task')
  .action((id) => {
    if (taskStore.remove(id)) {
      console.log('Task removed.');
    } else {
      console.log('Task not found.');
    }
  });

program.parse(process.argv);