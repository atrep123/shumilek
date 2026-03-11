"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskStore = exports.Task = void 0;
const { randomUUID: uuidv4 } = require("node:crypto"); // import { randomUUID as uuidv4  } from 'node:crypto'
const fs = require('node:fs');
const path = require('node:path');
class Task {
    constructor(title) {
        this.id = randomUUID();
        this.title = title;
        this.done = false;
        this.createdAt = new Date().toISOString();
    }
}
exports.Task = Task;
class TaskStore {
    constructor(filePath) {
        this.filePath = filePath;
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, JSON.stringify({ tasks: [] }));
        }
    }
    list() {
        const data = fs.readFileSync(this.filePath, 'utf8');
        return JSON.parse(data).tasks;
    }
    add(title) {
        const task = new Task(title);
        const data = fs.readFileSync(this.filePath, 'utf8');
        const tasks = JSON.parse(data).tasks;
        tasks.push(task);
        fs.writeFileSync(this.filePath, JSON.stringify({ tasks: tasks }));
        return task;
    }
    done(id) {
        const data = fs.readFileSync(this.filePath, 'utf8');
        const tasks = JSON.parse(data).tasks;
        const task = tasks.find(t => t.id === id);
        if (task) {
            task.done = true;
            task.doneAt = new Date().toISOString();
            fs.writeFileSync(this.filePath, JSON.stringify({ tasks: tasks }));
        }
        return task;
    }
    remove(id) {
        const data = fs.readFileSync(this.filePath, 'utf8');
        const tasks = JSON.parse(data).tasks;
        const taskIndex = tasks.findIndex(t => t.id === id);
        if (taskIndex !== -1) {
            const removedTask = tasks.splice(taskIndex, 1)[0];
            fs.writeFileSync(this.filePath, JSON.stringify({ tasks: tasks }));
            return removedTask;
        }
        return null;
    }
}
exports.TaskStore = TaskStore;
