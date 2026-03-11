"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskStore = void 0;
const fs = require("node:fs");
const crypto = require("node:crypto");
class TaskStore {
    constructor(filePath) {
        this.filePath = filePath;
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, JSON.stringify({ tasks: [] }));
        }
    }
    list() {
        const data = fs.readFileSync(this.filePath, 'utf-8');
        return JSON.parse(data).tasks;
    }
    add(title) {
        const tasks = this.list();
        const task = { id: crypto.randomUUID(), title, done: false, createdAt: new Date().toISOString() };
        tasks.push(task);
        fs.writeFileSync(this.filePath, JSON.stringify({ tasks }));
        return task;
    }
    done(id) {
        const tasks = this.list();
        const task = tasks.find(t => t.id === id);
        if (task) {
            task.done = true;
            task.doneAt = new Date().toISOString();
            fs.writeFileSync(this.filePath, JSON.stringify({ tasks }));
        }
        return task;
    }
    remove(id) {
        let tasks = this.list();
        tasks = tasks.filter(t => t.id !== id);
        fs.writeFileSync(this.filePath, JSON.stringify({ tasks }));
        return true;
    }
}
exports.TaskStore = TaskStore;
