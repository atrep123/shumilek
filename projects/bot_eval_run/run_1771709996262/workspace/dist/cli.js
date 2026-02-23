"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const store_1 = __importDefault(require("./store"));
commander_1.program
    .option('--data <path>', 'Path to the task data file')
    .helpOption('-h, --help', 'Display help information');
commander_1.program
    .command('add <title>')
    .action((title, options) => {
    if (!options.data) {
        console.error('--data option is required');
        process.exit(1);
    }
    const taskStore = new store_1.default(options.data);
    const task = taskStore.add(title);
    console.log(`Task added: ${task.title}`);
});
commander_1.program
    .command('list')
    .action((options) => {
    if (!options.data) {
        console.error('--data option is required');
        process.exit(1);
    }
    const taskStore = new store_1.default(options.data);
    const tasks = taskStore.list();
    console.log('Tasks:', tasks);
});
commander_1.program
    .command('done <id>')
    .action((id, options) => {
    if (!options.data) {
        console.error('--data option is required');
        process.exit(1);
    }
    const taskStore = new store_1.default(options.data);
    const task = taskStore.done(id);
    console.log(`Task marked as done: ${task.title}`);
});
commander_1.program
    .command('remove <id>')
    .action((id, options) => {
    if (!options.data) {
        console.error('--data option is required');
        process.exit(1);
    }
    const taskStore = new store_1.default(options.data);
    taskStore.remove(id);
    console.log(`Task removed with id: ${id}`);
});
commander_1.program.parse(process.argv);
