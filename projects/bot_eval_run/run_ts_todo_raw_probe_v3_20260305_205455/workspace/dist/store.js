"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskStore = void 0;
const fs = require("node:fs");
const path = require("node:path");
const uuid_1 = require("uuid");
class TaskStore {
    constructor(dataFilePath) {
        this.dataFilePath = dataFilePath;
    }
    async addTask(title) {
        const tasks = this.readTasks();
        tasks.push({ id: (0, uuid_1.v4)(), title, completed: false });
        this.writeTasks(tasks);
    }
    async listTasks() {
        return this.readTasks();
    }
    async markTaskAsDone(id) {
        const tasks = this.readTasks();
        const task = tasks.find(t => t.id === id);
        if (task) {
            task.completed = true;
            this.writeTasks(tasks);
        }
    }
    async removeTask(id) {
        const tasks = this.readTasks();
        const updatedTasks = tasks.filter(t => t.id !== id);
        this.writeTasks(updatedTasks);
    }
    readTasks() {
        const data = fs.readFileSync(this.dataFilePath, 'utf-8');
        return JSON.parse(data).tasks || [];
    }
    writeTasks(tasks) {
        fs.writeFileSync(this.dataFilePath, JSON.stringify({ tasks }, null, 2));
    }
}
exports.TaskStore = TaskStore;
