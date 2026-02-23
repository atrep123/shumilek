"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskStore = void 0;
const fs = require('node:fs');
const crypto = require('node:crypto');
class TaskStore {
    constructor(filePath) {
        this.filePath = filePath;
    }
    readTasks() {
        try {
            const data = fs.readFileSync(this.filePath, 'utf8');
            return JSON.parse(data).tasks || [];
        }
        catch (error) {
            if (error.code === 'ENOENT') {
                return [];
            }
            throw error;
        }
    }
    writeTasks(tasks) {
        const data = JSON.stringify({ tasks }, null, 2);
        fs.writeFileSync(this.filePath, data);
    }
    list() {
        return this.readTasks();
    }
    add(title) {
        const task = {
            id: crypto.randomUUID(),
            title,
            done: false,
            createdAt: new Date().toISOString()
        };
        const tasks = this.readTasks();
        tasks.push(task);
        this.writeTasks(tasks);
        return task;
    }
    done(id) {
        let tasks = this.readTasks();
        const task = tasks.find(t => t.id === id);
        if (task) {
            task.done = true;
            task.doneAt = new Date().toISOString();
            this.writeTasks(tasks);
        }
        return task || { id, title: '', done: false, createdAt: '' };
    }
    remove(id) {
        let tasks = this.readTasks();
        const taskIndex = tasks.findIndex(t => t.id === id);
        if (taskIndex !== -1) {
            const [task] = tasks.splice(taskIndex, 1);
            this.writeTasks(tasks);
            return task;
        }
        return { id, title: '', done: false, createdAt: '' };
    }
}
exports.TaskStore = TaskStore;
