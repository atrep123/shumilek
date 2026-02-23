"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskStore = void 0;
const node_crypto_1 = require("node:crypto");
const fs = require('node:fs');
class TaskStore {
    constructor(filePath) {
        this.filePath = filePath;
    }
    list() {
        try {
            const data = fs.readFileSync(this.filePath, 'utf8');
            return JSON.parse(data).tasks || [];
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return [];
            throw error;
        }
    }
    add(title) {
        const task = {
            id: (0, node_crypto_1.randomUUID)(),
            title,
            done: false,
            createdAt: new Date().toISOString()
        };
        const tasks = [...this.list(), task];
        fs.writeFileSync(this.filePath, JSON.stringify({ tasks }, null, 2));
        return task;
    }
    done(id) {
        const tasks = this.list();
        const index = tasks.findIndex(task => task.id === id);
        if (index < 0)
            throw new Error('Task not found');
        const task = Object.assign(Object.assign({}, tasks[index]), { done: true, doneAt: new Date().toISOString() });
        tasks[index] = task;
        fs.writeFileSync(this.filePath, JSON.stringify({ tasks }, null, 2));
        return task;
    }
    remove(id) {
        const tasks = this.list();
        const index = tasks.findIndex(task => task.id === id);
        if (index < 0)
            throw new Error('Task not found');
        const [task] = tasks.splice(index, 1);
        fs.writeFileSync(this.filePath, JSON.stringify({ tasks }, null, 2));
        return task;
    }
}
exports.TaskStore = TaskStore;
