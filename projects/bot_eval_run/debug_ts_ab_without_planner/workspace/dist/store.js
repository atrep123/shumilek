"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskStore = void 0;
const fs_1 = require("fs");
const crypto_1 = require("crypto");
class TaskStore {
    constructor(filePath) {
        this.filePath = filePath;
    }
    readTasks() {
        try {
            const data = (0, fs_1.readFileSync)(this.filePath, 'utf-8');
            return JSON.parse(data);
        }
        catch (error) {
            if (error.code === 'ENOENT') {
                return [];
            }
            throw error;
        }
    }
    writeTasks(tasks) {
        (0, fs_1.writeFileSync)(this.filePath, JSON.stringify(tasks, null, 2));
    }
    list() {
        return this.readTasks();
    }
    add(title) {
        const task = {
            id: (0, crypto_1.randomUUID)(),
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
        const taskIndex = tasks.findIndex(t => t.id === id);
        if (taskIndex !== -1) {
            tasks[taskIndex].done = true;
            tasks[taskIndex].doneAt = new Date().toISOString();
            this.writeTasks(tasks);
            return tasks[taskIndex];
        }
        throw new Error('Task not found');
    }
    remove(id) {
        let tasks = this.readTasks();
        const taskIndex = tasks.findIndex(t => t.id === id);
        if (taskIndex !== -1) {
            const removedTask = tasks.splice(taskIndex, 1)[0];
            this.writeTasks(tasks);
            return removedTask;
        }
        throw new Error('Task not found');
    }
}
exports.TaskStore = TaskStore;
