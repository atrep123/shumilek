"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskStore = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const uuid_1 = require("uuid");
class TaskStore {
    constructor(filePath) {
        this.filePath = filePath;
        this.tasks = [];
        if (node_fs_1.default.existsSync(this.filePath)) {
            const data = node_fs_1.default.readFileSync(this.filePath, 'utf8');
            this.tasks = JSON.parse(data).tasks || [];
        }
    }
    list() {
        return this.tasks;
    }
    add(title) {
        const task = {
            id: (0, uuid_1.v4)(),
            title,
            done: false,
            createdAt: new Date().toISOString()
        };
        this.tasks.push(task);
        this.save();
        return task;
    }
    done(id) {
        const task = this.tasks.find(t => t.id === id);
        if (task) {
            task.done = true;
            task.doneAt = new Date().toISOString();
            this.save();
        }
        return task;
    }
    remove(id) {
        const index = this.tasks.findIndex(t => t.id === id);
        if (index !== -1) {
            const removedTask = this.tasks[index];
            this.tasks.splice(index, 1);
            this.save();
            return removedTask;
        }
        throw new Error('Task not found');
    }
    save() {
        node_fs_1.default.writeFileSync(this.filePath, JSON.stringify({ tasks: this.tasks }, null, 2));
    }
}
exports.TaskStore = TaskStore;
