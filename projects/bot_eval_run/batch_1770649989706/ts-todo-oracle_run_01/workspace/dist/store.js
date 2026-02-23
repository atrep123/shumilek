"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskStore = void 0;
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
exports.TaskStore = TaskStore;
