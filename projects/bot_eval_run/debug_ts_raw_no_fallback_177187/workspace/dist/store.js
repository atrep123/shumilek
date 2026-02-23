"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskStore = exports.Task = void 0;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = __importDefault(require("node:fs"));
class Task {
    constructor(title) {
        this.id = (0, node_crypto_1.v4)();
        this.title = title;
        this.done = false;
        this.createdAt = new Date().toISOString();
    }
}
exports.Task = Task;
class TaskStore {
    constructor(filePath) {
        this.filePath = filePath;
    }
    list() {
        if (!existsSync(this.filePath))
            return [];
        const data = node_fs_1.default.readFileSync(this.filePath, 'utf8');
        return JSON.parse(data).tasks || [];
    }
    add(title) {
        const task = new Task(title);
        const tasks = this.list();
        tasks.push(task);
        node_fs_1.default.writeFileSync(this.filePath, JSON.stringify({ tasks }, null, 2));
        return task;
    }
    done(id) {
        const tasks = this.list();
        const taskIndex = tasks.findIndex(t => t.id === id);
        if (taskIndex !== -1) {
            tasks[taskIndex].done = true;
            tasks[taskIndex].doneAt = new Date().toISOString();
            node_fs_1.default.writeFileSync(this.filePath, JSON.stringify({ tasks }, null, 2));
        }
        return tasks[taskIndex];
    }
    remove(id) {
        const tasks = this.list();
        const taskIndex = tasks.findIndex(t => t.id === id);
        if (taskIndex !== -1) {
            const removedTask = tasks[taskIndex];
            tasks.splice(taskIndex, 1);
            node_fs_1.default.writeFileSync(this.filePath, JSON.stringify({ tasks }, null, 2));
            return removedTask;
        }
        throw new Error('Task not found');
    }
}
exports.TaskStore = TaskStore;
