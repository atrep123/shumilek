"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = require("node:fs");
const node_crypto_1 = require("node:crypto");
class TaskStore {
    constructor(filePath) {
        this.tasks = [];
        this.filePath = filePath;
        try {
            const data = (0, node_fs_1.readFileSync)(this.filePath, 'utf8');
            this.tasks = JSON.parse(data).tasks || [];
        }
        catch (error) { }
    }
    list() {
        return this.tasks;
    }
    add(title) {
        const task = { id: (0, node_crypto_1.randomUUID)(), title, done: false, createdAt: new Date().toISOString() };
        this.tasks.push(task);
        this.save();
        return task;
    }
    done(id) {
        const task = this.tasks.find(t => t.id === id);
        if (task) {
            task.done = true;
            task.doneAt = new Date().toISOString();
            this.save();
        }
        return task;
    }
    remove(id) {
        const index = this.tasks.findIndex(t => t.id === id);
        if (index >= 0) {
            const [task] = this.tasks.splice(index, 1);
            this.save();
            return task;
        }
        throw new Error('Task not found');
    }
    save() {
        (0, node_fs_1.writeFileSync)(this.filePath, JSON.stringify({ tasks: this.tasks }, null, 2));
    }
}
const argv = process.argv.slice(2);
const cmd = argv[0];
let dataPath = 'tasks.json';
for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--data' && i + 1 < argv.length) {
        dataPath = argv[++i];
    }
}
const store = new TaskStore(dataPath);
if (cmd === '--help') {
    console.log('Usage:');
    console.log('- Add task: node dist/cli.js add "Buy milk" --data tasks.json');
    console.log('- List tasks: node dist/cli.js list --data tasks.json');
    console.log('- Mark task as done: node dist/cli.js done <id> --data tasks.json');
    console.log('- Remove task: node dist/cli.js remove <id> --data tasks.json');
    process.exit(0);
}
else if (cmd === 'list') {
    const tasks = store.list();
    console.log(JSON.stringify({ ok: true, tasks }, null, 2));
}
else if (cmd === 'add' && argv.length > 2) {
    const title = argv[1];
    const task = store.add(title);
    console.log(JSON.stringify({ ok: true, task }, null, 2));
}
else if (cmd === 'done' && argv.length > 2) {
    const id = argv[1];
    try {
        const task = store.done(id);
        console.log(JSON.stringify({ ok: true, task }, null, 2));
    }
    catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}
else if (cmd === 'remove' && argv.length > 2) {
    const id = argv[1];
    try {
        const task = store.remove(id);
        console.log(JSON.stringify({ ok: true, task }, null, 2));
    }
    catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}
else {
    console.error('Invalid command');
    process.exit(1);
}
