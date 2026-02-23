"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
export const program = new Command();

program
  .name('todo')
  .description('A simple command-line todo list manager');

program.command('list').option('--data <path>', 'Path to the data file', process.cwd())
  .action((options) => {
    const store = new InMemoryTaskStore(options.data);
    console.log(JSON.stringify({ ok: true, tasks: store.list() }));
});

program.command('add <title>').option('--data <path>', 'Path to the data file', process.cwd())
  .action((title, options) => {
    const store = new InMemoryTaskStore(options.data);
    const task = store.add(title);
    console.log(JSON.stringify({ ok: true, task }));
});

program.command('done <id>').option('--data <path>', 'Path to the data file', process.cwd())
  .action((id, options) => {
    const store = new InMemoryTaskStore(options.data);
    const task = store.done(id);
    console.log(JSON.stringify({ ok: true, task }));
});

program.command('remove <id>').option('--data <path>', 'Path to the data file', process.cwd())
  .action((id, options) => {
    const store = new InMemoryTaskStore(options.data);
    const task = store.remove(id);
    console.log(JSON.stringify({ ok: true, task }));
});

program.parse();
