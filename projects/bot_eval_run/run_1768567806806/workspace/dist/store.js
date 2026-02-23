"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskStore = void 0;
const fs = require('node:fs');
const path = require('node:path');
class TaskStore {
    constructor(filePath) {
        this.tasks = [];
        this.filePath = filePath;
        if (fs.existsSync(filePath)) {
            try {
                const data = fs.readFileSync(filePath, 'utf8');
                this.tasks = JSON.parse(data) || [];
            }
            catch (e) {
                console.error('Failed to read task file:', e);
            }
        }
    }
    list() {
        return [...this.tasks];
    }
    add(title) {
        const newTask = {
            id: Date.now().toString(),
            title,
            done: false,
            createdAt: new Date().toISOString()
        };
        this.tasks.push(newTask);
        this.save();
        return newTask;
    }
    done(id) {
        const task = this.tasks.find(t => t.id === id);
        if (task && !task.done) {
            task.done = true;
            task.doneAt = new Date().toISOString();
            this.save();
        }
        return task;
    }
    remove(id) {
        const index = this.tasks.findIndex(t => t.id === id);
        if (index !== -1) {
            const removedTask = this.tasks.splice(index, 1)[0];
            this.save();
            return removedTask;
        }
        return undefined;
    }
    save() {
        try {
            fs.writeFileSync(this.filePath, JSON.stringify({ tasks: this.tasks }, null, 2));
        }
        catch (e) {
            console.error('Failed to write task file:', e);
        }
    }
}
exports.TaskStore = TaskStore;
