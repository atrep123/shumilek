"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskStore = void 0;
const fs = require('node:fs');
const crypto = require('node:crypto');
class TaskStore {
    constructor(filePath) {
        this.filePath = filePath;
    }
    readData() {
        try {
            const raw = fs.readFileSync(this.filePath, 'utf8');
            const parsed = JSON.parse(raw);
            const tasks = Array.isArray(parsed?.tasks) ? parsed.tasks : [];
            return { tasks };
        }
        catch (error) {
            if (error?.code === 'ENOENT')
                return { tasks: [] };
            throw error;
        }
    }
    writeData(file) {
        fs.writeFileSync(this.filePath, JSON.stringify(file, null, 2), 'utf8');
    }
    list() {
        return this.readData().tasks;
    }
    add(title) {
        const file = this.readData();
        const task = {
            id: crypto.randomUUID(),
            title,
            done: false,
            createdAt: new Date().toISOString()
        };
        file.tasks.push(task);
        this.writeData(file);
        return task;
    }
    done(id) {
        const file = this.readData();
        const idx = file.tasks.findIndex((t) => t.id === id);
        if (idx < 0)
            throw new Error('Task not found');
        file.tasks[idx].done = true;
        file.tasks[idx].doneAt = new Date().toISOString();
        this.writeData(file);
        return file.tasks[idx];
    }
    remove(id) {
        const file = this.readData();
        const idx = file.tasks.findIndex((t) => t.id === id);
        if (idx < 0)
            throw new Error('Task not found');
        const [removed] = file.tasks.splice(idx, 1);
        this.writeData(file);
        return removed;
    }
}
exports.TaskStore = TaskStore;
