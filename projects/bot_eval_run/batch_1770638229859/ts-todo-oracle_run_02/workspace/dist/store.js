"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskStore = void 0;
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
            if (error.code === 'ENOENT') {
                return [];
            }
            throw error;
        }
    }
    add(title) {
        const task = {
            id: crypto.randomUUID(),
            title,
            done: false,
            createdAt: new Date().toISOString()
        };
        const tasks = this.list();
        tasks.push(task);
        fs.writeFileSync(this.filePath, JSON.stringify({ tasks }, null, 2));
        return task;
    }
    done(id) {
        let tasks = this.list();
        const task = tasks.find(t => t.id === id);
        if (task) {
            task.done = true;
            task.doneAt = new Date().toISOString();
            fs.writeFileSync(this.filePath, JSON.stringify({ tasks }, null, 2));
        }
        return task || { id, title: '', done: false, createdAt: '' };
    }
    remove(id) {
        let tasks = this.list();
        const taskIndex = tasks.findIndex(t => t.id === id);
        if (taskIndex !== -1) {
            const removedTask = tasks[taskIndex];
            tasks.splice(taskIndex, 1);
            fs.writeFileSync(this.filePath, JSON.stringify({ tasks }, null, 2));
            return removedTask;
        }
        return { id, title: '', done: false, createdAt: '' };
    }
}
exports.TaskStore = TaskStore;
