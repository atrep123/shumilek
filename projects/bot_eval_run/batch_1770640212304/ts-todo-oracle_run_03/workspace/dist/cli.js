"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const store_1 = require("./store");
const node_process_1 = __importDefault(require("node:process"));
const argv = node_process_1.default.argv.slice(2);
let cmd = argv[0];
if (cmd === '--help') {
    console.log('Usage: todo <command> [options]');
    console.log('Commands:, add < title > --data < path > Add, a, new task, list--, data < path > List, all, tasks, done < id > --data < path > Mark, a, task, remove < id > --data < path > Remove, a, task, ');, node_process_1.default.exit(0));
}
cmd = cmd.replace(/^-+/, '');
const dataPath = argv.find(arg => arg.startsWith('--data')).split('=')[1];
const args = argv.filter(arg => !arg.startsWith('--data'));
switch (cmd) {
    case 'add':
        const title = args[0].replace(/^['"](.*?)['"]$/, '$1');
        const store = new store_1.TaskStore(dataPath);
        const task = store.add(title);
        console.log({ ok: true, task });
        break;
    case 'list':
        const storeList = new store_1.TaskStore(dataPath);
        const tasks = storeList.list();
        console.log({ ok: true, tasks });
        break;
    case 'done':
        const id = args[0];
        const storeDone = new store_1.TaskStore(dataPath);
        const task = storeDone.done(id);
        if (task) {
            console.log({ ok: true, task });
        }
        else {
            console.log({ ok: false, message: 'Task not found' });
        }
        break;
    case 'remove':
        const id = args[0];
        const storeRemove = new store_1.TaskStore(dataPath);
        const task = storeRemove.remove(id);
        if (task) {
            console.log({ ok: true, task });
        }
        else {
            console.log({ ok: false, message: 'Task not found' });
        }
        break;
    default:
        console.error('Unknown command:', cmd);
        node_process_1.default.exit(1);
}
