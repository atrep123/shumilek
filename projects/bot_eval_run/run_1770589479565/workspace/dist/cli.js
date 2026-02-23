"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.program = void 0;
Object.defineProperty(exports, "__esModule", { value: true });
exports.program = new Command();
exports.program
    .name('todo')
    .description('A simple command-line todo list manager');
exports.program.command('list').option('--data <path>', 'Path to the data file', process.cwd())
    .action((options) => {
    const store = new InMemoryTaskStore(options.data);
    console.log(JSON.stringify({ ok: true, tasks: store.list() }));
});
exports.program.command('add <title>').option('--data <path>', 'Path to the data file', process.cwd())
    .action((title, options) => {
    const store = new InMemoryTaskStore(options.data);
    const task = store.add(title);
    console.log(JSON.stringify({ ok: true, task }));
});
exports.program.command('done <id>').option('--data <path>', 'Path to the data file', process.cwd())
    .action((id, options) => {
    const store = new InMemoryTaskStore(options.data);
    const task = store.done(id);
    console.log(JSON.stringify({ ok: true, task }));
});
exports.program.command('remove <id>').option('--data <path>', 'Path to the data file', process.cwd())
    .action((id, options) => {
    const store = new InMemoryTaskStore(options.data);
    const task = store.remove(id);
    console.log(JSON.stringify({ ok: true, task }));
});
exports.program.parse();
