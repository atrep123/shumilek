"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const store_1 = require("./store");
const fs = require('node:fs');
const process = require('node:process');
const argv = process.argv.slice(2);
let cmd = argv[0];
let dataPath = '';
if (argv.includes('--data')) {
    const index = argv.indexOf('--data');
    if (index !== -1 && index + 1 < argv.length) {
        dataPath = argv[index + 1];
    }
}
const store = new store_1.TaskStore(dataPath);
function help() {
    console.log('Usage: task-manager <command> [options]');
    console.log('');
    console.log('Commands:');
    console.log('  add <title>    Add a new task with the title');
    console.log('  list          List all tasks');
    console.log('  done <id>      Mark a task as done by its ID');
    console.log('  remove <id>    Remove a task by its ID');
}
switch (cmd) {
    case 'list':
        const tasks = store.list();
        console.log(JSON.stringify({ ok: true, tasks }, null, 2));
        break;
    case 'add':
        if (argv.length < 2) {
            console.error('Missing title for the task');
            process.exit(1);
        }
        const title = argv[1];
        const newTask = store.add(title);
        console.log(JSON.stringify({ ok: true, task: newTask }, null, 2));
        break;
    case 'done':
        if (argv.length < 2) {
            console.error('Missing ID for the task');
            process.exit(1);
        }
        const id = argv[1];
        try {
            const doneTask = store.done(id);
            console.log(JSON.stringify({ ok: true, task: doneTask }, null, 2));
        }
        catch (error) {
            console.error('Task not found');
            process.exit(1);
        }
        break;
    case 'remove':
        if (argv.length < 2) {
            console.error('Missing ID for the task');
            process.exit(1);
        }
        const id = argv[1];
        try {
            const removedTask = store.remove(id);
            console.log(JSON.stringify({ ok: true, task: removedTask }, null, 2));
        }
        catch (error) {
            console.error('Task not found');
            process.exit(1);
        }
        break;
    default:
        help();
        break;
}
