import { program } from 'commander';
import TaskStore from './store';

program
  .option('--data <path>', 'Path to the task data file')
  .helpOption('-h, --help', 'Display help information');

program
  .command('add <title>')
  .action((title: string, options) => {
    if (!options.data) {
      console.error('--data option is required');
      process.exit(1);
    }
    const taskStore = new TaskStore(options.data);
    const task = taskStore.add(title);
    console.log(`Task added: ${task.title}`);
  });

program
  .command('list')
  .action((options) => {
    if (!options.data) {
      console.error('--data option is required');
      process.exit(1);
    }
    const taskStore = new TaskStore(options.data);
    const tasks = taskStore.list();
    console.log('Tasks:', tasks);
  });

program
  .command('done <id>')
  .action((id: string, options) => {
    if (!options.data) {
      console.error('--data option is required');
      process.exit(1);
    }
    const taskStore = new TaskStore(options.data);
    const task = taskStore.done(id);
    console.log(`Task marked as done: ${task.title}`);
  });

program
  .command('remove <id>')
  .action((id: string, options) => {
    if (!options.data) {
      console.error('--data option is required');
      process.exit(1);
    }
    const taskStore = new TaskStore(options.data);
    taskStore.remove(id);
    console.log(`Task removed with id: ${id}`);
  });

program.parse(process.argv);