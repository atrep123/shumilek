"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskStore = void 0;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = __importDefault(require("node:fs"));
class TaskStore {
    constructor(filePath) {
        this.filePath = filePath;
    }
    readTasks() {
        try {
            const data = node_fs_1.default.readFileSync(this.filePath, 'utf8');
            return JSON.parse(data).tasks || [];
        }
        catch (error) {
            if (error.code === 'ENOENT') {
                return [];
            }
            throw error;
        }
    }
    writeTasks(tasks) {
        const data = JSON.stringify({ tasks }, null, 2);
        node_fs_1.default.writeFileSync(this.filePath, data);
    }
    list() {
        return this.readTasks();
    }
    add(title) {
        const task = {
            id: (0, node_crypto_1.randomUUID)(),
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
        const task = tasks.find(t => t.id === id);
        if (task) {
            task.done = true;
            task.doneAt = new Date().toISOString();
            this.writeTasks(tasks);
        }
        return task || { id, title: '', done: false, createdAt: '' };
    }
    remove(id) {
        let tasks = this.readTasks();
        const taskIndex = tasks.findIndex(t => t.id === id);
        if (taskIndex !== -1) {
            const removedTask = tasks[taskIndex];
            tasks.splice(taskIndex, 1);
            this.writeTasks(tasks);
            return removedTask;
        }
        return { id, title: '', done: false, createdAt: '' };
    }
}
exports.TaskStore = TaskStore;
