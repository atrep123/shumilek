"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskStore = void 0;
const fs = require("node:fs");
const path = require("node:path");
class TaskStore {
    constructor(filePath) {
        this.tasks = [];
        this.filePath = path.resolve(process.cwd(), filePath);
        this.loadTasks();
    }
    list() {
        return [...this.tasks];
    }
    add(title) {
        const task = {
            id: Math.random().toString(36).substr(2, 9),
            title,
            done: false,
            createdAt: new Date().toISOString()
        };
        this.tasks.push(task);
        this.saveTasks();
        return task;
    }
    done(id) {
        const task = this.tasks.find(t => t.id === id);
        if (!task)
            throw new Error(`Task with ID ${id} not found`);
        task.done = true;
        task.doneAt = new Date().toISOString();
        this.saveTasks();
        return task;
    }
    remove(id) {
        const index = this.tasks.findIndex(t => t.id === id);
        if (index < 0)
            throw new Error(`Task with ID ${id} not found`);
        const [removedTask] = this.tasks.splice(index, 1);
        this.saveTasks();
        return removedTask;
    }
    loadTasks() {
        try {
            const data = fs.readFileSync(this.filePath, 'utf8');
            const parsedData = JSON.parse(data);
            if (Array.isArray(parsedData.tasks)) {
                this.tasks = parsedData.tasks.map((t) => ({ ...t }));
            }
        }
        catch { }
    }
    saveTasks() {
        fs.writeFileSync(this.filePath, JSON.stringify({ tasks: this.tasks }), 'utf8');
    }
}
exports.TaskStore = TaskStore;
