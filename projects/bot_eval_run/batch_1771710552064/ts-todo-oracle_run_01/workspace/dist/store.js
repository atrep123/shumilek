"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskStore = void 0;
const fs_1 = require("fs");
const crypto_1 = require("crypto");
class TaskStore {
    constructor(filePath) {
        this.filePath = filePath;
    }
    list() {
        try {
            const data = (0, fs_1.readFileSync)(this.filePath, 'utf-8');
            return JSON.parse(data).tasks || [];
        }
        catch (error) {
            if (error.code === 'ENOENT') {
                (0, fs_1.writeFileSync)(this.filePath, JSON.stringify({ tasks: [] }, null, 2));
                return [];
            }
            throw error;
        }
    }
    add(title) {
        const task = {
            id: (0, crypto_1.randomUUID)(),
            title,
            done: false,
            createdAt: new Date().toISOString()
        };
        const tasks = this.list();
        tasks.push(task);
        (0, fs_1.writeFileSync)(this.filePath, JSON.stringify({ tasks }, null, 2));
        return task;
    }
    done(id) {
        let tasks = this.list();
        const taskIndex = tasks.findIndex(t => t.id === id);
        if (taskIndex !== -1) {
            tasks[taskIndex].done = true;
            tasks[taskIndex].doneAt = new Date().toISOString();
            (0, fs_1.writeFileSync)(this.filePath, JSON.stringify({ tasks }, null, 2));
            return tasks[taskIndex];
        }
        throw new Error('Task not found');
    }
    remove(id) {
        let tasks = this.list();
        const taskIndex = tasks.findIndex(t => t.id === id);
        if (taskIndex !== -1) {
            const removedTask = tasks.splice(taskIndex, 1)[0];
            (0, fs_1.writeFileSync)(this.filePath, JSON.stringify({ tasks }, null, 2));
            return removedTask;
        }
        throw new Error('Task not found');
    }
}
exports.TaskStore = TaskStore;
