"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskStore = void 0;
const { randomUUID: uuidv4 } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
class TaskStore {
    constructor(filePath) {
        this.filePath = filePath;
        if (!fs.existsSync(this.filePath)) {
            fs.writeFileSync(this.filePath, JSON.stringify({ tasks: [] }));
        }
    }
    list() {
        const data = fs.readFileSync(this.filePath, 'utf8');
        return JSON.parse(data).tasks;
    }
    add(title) {
        const tasks = this.list();
        const task = {
            id: uuidv4(),
            title,
            done: false,
            createdAt: new Date().toISOString()
        };
        tasks.push(task);
        fs.writeFileSync(this.filePath, JSON.stringify({ tasks }));
        return task;
    }
    done(id) {
        const tasks = this.list();
        const taskIndex = tasks.findIndex(t => t.id === id);
        if (taskIndex !== -1) {
            tasks[taskIndex].done = true;
            tasks[taskIndex].doneAt = new Date().toISOString();
            fs.writeFileSync(this.filePath, JSON.stringify({ tasks }));
        }
        return tasks[taskIndex];
    }
    remove(id) {
        const tasks = this.list();
        const taskIndex = tasks.findIndex(t => t.id === id);
        if (taskIndex !== -1) {
            const removedTask = tasks[taskIndex];
            tasks.splice(taskIndex, 1);
            fs.writeFileSync(this.filePath, JSON.stringify({ tasks }));
            return removedTask;
        }
        throw new Error('Task not found');
    }
}
exports.TaskStore = TaskStore;
