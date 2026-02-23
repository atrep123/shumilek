"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskStore = void 0;
class TaskStore {
    constructor(filePath) {
        this.filePath = filePath;
        this.tasks = this.loadTasks();
    }
    loadTasks() {
        if (!fs.existsSync(this.filePath))
            return [];
        const data = fs.readFileSync(this.filePath, 'utf8');
        return JSON.parse(data).tasks || [];
    }
    list() {
        return this.tasks;
    }
    add(title) {
        const task = { id: crypto.randomUUID(), title, done: false, createdAt: new Date().toISOString() };
        this.tasks.push(task);
        this.saveTasks();
        return task;
    }
    done(id) {
        const task = this.tasks.find(t => t.id === id);
        if (task) {
            task.done = true;
            task.doneAt = new Date().toISOString();
            this.saveTasks();
        }
        return task;
    }
    remove(id) {
        const index = this.tasks.findIndex(t => t.id === id);
        if (index !== -1) {
            const removedTask = this.tasks.splice(index, 1)[0];
            this.saveTasks();
            return removedTask;
        }
        throw new Error('Task not found');
    }
    saveTasks() {
        fs.writeFileSync(this.filePath, JSON.stringify({ tasks: this.tasks }, null, 2));
    }
}
exports.TaskStore = TaskStore;
