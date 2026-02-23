"use strict";
// src/store.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskStore = void 0;
const fs = require('node:fs');
const crypto = require('node:crypto');
class TaskStore {
    constructor(filePath) {
        this.filePath = filePath;
    }
    list() {
        if (!fs.existsSync(this.filePath))
            return [];
        const data = fs.readFileSync(this.filePath, 'utf8');
        return JSON.parse(data).tasks || [];
    }
    add(title) {
        const task = {
            id: crypto.randomUUID(),
            title,
            done: false,
            createdAt: new Date().toISOString()
        };
        let tasks = this.list();
        tasks.push(task);
        fs.writeFileSync(this.filePath, JSON.stringify({ tasks }, null, 2));
        return task;
    }
    done(id) {
        let tasks = this.list();
        const taskIndex = tasks.findIndex(t => t.id === id);
        if (taskIndex === -1)
            throw new Error('Task not found');
        const task = tasks[taskIndex];
        task.done = true;
        task.doneAt = new Date().toISOString();
        fs.writeFileSync(this.filePath, JSON.stringify({ tasks }, null, 2));
        return task;
    }
    remove(id) {
        let tasks = this.list();
        const taskIndex = tasks.findIndex(t => t.id === id);
        if (taskIndex === -1)
            throw new Error('Task not found');
        const task = tasks[taskIndex];
        tasks.splice(taskIndex, 1);
        fs.writeFileSync(this.filePath, JSON.stringify({ tasks }, null, 2));
        return task;
    }
}
exports.TaskStore = TaskStore;
