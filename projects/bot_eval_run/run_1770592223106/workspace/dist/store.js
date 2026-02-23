"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskStore = void 0;
const node_crypto_1 = require("node:crypto");
const fs = require('node:fs');
const path = require('node:path');
class TaskStore {
    constructor(filePath) {
        this.filePath = filePath;
    }
    list() {
        try {
            const data = fs.readFileSync(this.filePath, 'utf8');
            return JSON.parse(data).tasks || [];
        }
        catch (e) {
            return [];
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
        if (index >= 0) {
            tasks[index].done = true;
            tasks[index].doneAt = new Date().toISOString();
            fs.writeFileSync(this.filePath, JSON.stringify({ tasks }, null, 2));
            return tasks[index];
        }
        throw new Error('Task not found');
    }
    remove(id) {
        const tasks = this.list();
        const index = tasks.findIndex(task => task.id === id);
        if (index >= 0) {
            const removedTask = tasks.splice(index, 1)[0];
            fs.writeFileSync(this.filePath, JSON.stringify({ tasks }, null, 2));
            return removedTask;
        }
        throw new Error('Task not found');
    }
}
exports.TaskStore = TaskStore;
