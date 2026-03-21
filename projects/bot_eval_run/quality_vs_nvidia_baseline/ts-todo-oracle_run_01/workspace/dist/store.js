"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskStore = void 0;
const { randomUUID: uuidv4 } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
class TaskStore {
    constructor(filePath) {
        this.tasks = [];
        this.filePath = filePath;
        if (fs.existsSync(this.filePath)) {
            const data = fs.readFileSync(this.filePath, 'utf8');
            this.tasks = JSON.parse(data).tasks || [];
        }
        else {
            fs.writeFileSync(this.filePath, JSON.stringify({ tasks: [] }));
        }
    }
    list() {
        return this.tasks;
    }
    add(title) {
        const task = { id: uuidv4(), title, done: false, createdAt: new Date().toISOString() };
        this.tasks.push(task);
        fs.writeFileSync(this.filePath, JSON.stringify({ tasks: this.tasks }));
        return task;
    }
    done(id) {
        const task = this.tasks.find(t => t.id === id);
        if (task) {
            task.done = true;
            task.doneAt = new Date().toISOString();
            fs.writeFileSync(this.filePath, JSON.stringify({ tasks: this.tasks }));
        }
        return task;
    }
    remove(id) {
        const index = this.tasks.findIndex(t => t.id === id);
        if (index !== -1) {
            const removedTask = this.tasks[index];
            this.tasks.splice(index, 1);
            fs.writeFileSync(this.filePath, JSON.stringify({ tasks: this.tasks }));
            return removedTask;
        }
        throw new Error('Task not found');
    }
}
exports.TaskStore = TaskStore;
