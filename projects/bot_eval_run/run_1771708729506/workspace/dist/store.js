"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskStore = void 0;
const fs_1 = require("fs");
const path_1 = require("path");
const crypto_1 = require("crypto");
class TaskStore {
    constructor(filePath) {
        this.tasks = [];
        this.filePath = (0, path_1.join)(__dirname, filePath);
        this.loadTasks();
    }
    loadTasks() {
        try {
            const data = (0, fs_1.readFileSync)(this.filePath, 'utf-8');
            this.tasks = JSON.parse(data) || [];
        }
        catch (error) {
            // If the file doesn't exist or is empty, tasks will remain an empty array
            if (error.code !== 'ENOENT') {
                throw error;
            }
        }
    }
    saveTasks() {
        (0, fs_1.writeFileSync)(this.filePath, JSON.stringify(this.tasks, null, 2));
    }
    list() {
        return this.tasks;
    }
    add(title) {
        const task = {
            id: (0, crypto_1.randomUUID)(),
            title,
            completed: false,
        };
        this.tasks.push(task);
        this.saveTasks();
        return task;
    }
    done(id) {
        const task = this.tasks.find(t => t.id === id);
        if (task) {
            task.completed = true;
            this.saveTasks();
        }
        return task || null;
    }
    remove(id) {
        const index = this.tasks.findIndex(t => t.id === id);
        if (index !== -1) {
            const removedTask = this.tasks.splice(index, 1)[0];
            this.saveTasks();
            return removedTask;
        }
        return null;
    }
}
exports.TaskStore = TaskStore;
