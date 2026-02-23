"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskStore = void 0;
const fs_1 = require("fs");
const path_1 = require("path");
const crypto_1 = require("crypto");
class TaskStore {
    constructor(filePath) {
        this.filePath = (0, path_1.join)(__dirname, '..', filePath);
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
        const task = tasks.find(t => t.id === id);
        if (task) {
            task.done = true;
            task.doneAt = new Date().toISOString();
            (0, fs_1.writeFileSync)(this.filePath, JSON.stringify({ tasks }, null, 2));
        }
        return task || { id, title: '', done: false, createdAt: '' };
    }
    remove(id) {
        let tasks = this.list();
        tasks = tasks.filter(t => t.id !== id);
        (0, fs_1.writeFileSync)(this.filePath, JSON.stringify({ tasks }, null, 2));
    }
}
exports.TaskStore = TaskStore;
