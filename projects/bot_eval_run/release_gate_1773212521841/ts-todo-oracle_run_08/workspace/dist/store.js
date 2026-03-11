"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskStore = void 0;
const { readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { randomUUID } = require("node:crypto");
class TaskStore {
    constructor(filePath) {
        this.filePath = filePath;
    }
    readTasks() {
        try {
            const data = readFileSync(this.filePath, 'utf-8');
            const parsed = JSON.parse(data);
            return Array.isArray(parsed?.tasks) ? parsed.tasks : (Array.isArray(parsed) ? parsed : []);
        }
        catch (error) {
            if (error.code === 'ENOENT') {
                return [];
            }
            throw error;
        }
    }
    writeTasks(tasks) {
        writeFileSync(this.filePath, JSON.stringify({ tasks }, null, 2));
    }
    list() {
        return this.readTasks();
    }
    add(title) {
        const task = {
            id: randomUUID(),
            title,
            done: false,
            createdAt: new Date().toISOString(),
        };
        const tasks = this.readTasks();
        tasks.push(task);
        this.writeTasks(tasks);
        return task;
    }
    done(id) {
        const tasks = this.readTasks();
        const task = tasks.find(t => t.id === id);
        if (task) {
            task.done = true;
            task.doneAt = new Date().toISOString();
            this.writeTasks(tasks);
        }
        if (!task)
            throw new Error('Task not found');
        return task;
    }
    remove(id) {
        const tasks = this.readTasks();
        const taskIndex = tasks.findIndex(t => t.id === id);
        if (taskIndex !== -1) {
            const removedTask = tasks.splice(taskIndex, 1)[0];
            this.writeTasks(tasks);
            return removedTask;
        }
        return { id, title: '', done: false, createdAt: '' };
    }
}
exports.TaskStore = TaskStore;
