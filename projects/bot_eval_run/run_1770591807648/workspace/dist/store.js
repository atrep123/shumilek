"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskStore = exports.Task = void 0;
const uuid_1 = require("uuid");
const fs = __importStar(require("path"));
const crypto = require('crypto');
class Task {
}
exports.Task = Task;
class TaskStore {
    constructor(filePath) {
        this.filePath = filePath;
        if (fs.existsSync(this.filePath)) {
            const data = fs.readFileSync(this.filePath, 'utf8');
            this.tasks = JSON.parse(data).tasks || [];
        }
        else {
            this.tasks = [];
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
        fs.writeFileSync(this.filePath, JSON.stringify({ tasks: this.tasks }));
        return task;
    }
    done(id) {
        const task = this.tasks.find(t => t.id === id);
        if (task) {
            task.done = true;
            task.doneAt = new Date().toISOString();
            fs.writeFileSync(this.filePath, JSON.stringify({ tasks: this.tasks }));
        }
        return task;
    }
    remove(id) {
        const index = this.tasks.findIndex(t => t.id === id);
        if (index !== -1) {
            const removedTask = this.tasks[index];
            this.tasks.splice(index, 1);
            fs.writeFileSync(this.filePath, JSON.stringify({ tasks: this.tasks }));
            return removedTask;
        }
        throw new Error('Task not found');
    }
}
exports.TaskStore = TaskStore;
