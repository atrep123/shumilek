"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskStore = void 0;
class TaskStore {
    constructor(filePath) {
        this.filePath = filePath;
        this.tasks = [];
    }
    list() {
        try {
            const data = fs.readFileSync(this.filePath, 'utf-8');
            this.tasks = JSON.parse(data);
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
            this.tasks = [];
        }
        return this.tasks;
    }
    add(title) {
        const task = { id: Date.now().toString(), title, completed: false };
        this.tasks.push(task);
        this.save();
        return task;
    }
    done(id) {
        const task = this.tasks.find(t => t.id === id);
        if (task) {
            task.completed = true;
            this.save();
        }
        return task || null;
    }
    remove(id) {
        const index = this.tasks.findIndex(t => t.id === id);
        if (index !== -1) {
            const removedTask = this.tasks.splice(index, 1)[0];
            this.save();
            return removedTask;
        }
        return null;
    }
    save() {
        fs.writeFileSync(this.filePath, JSON.stringify(this.tasks, null, 2));
    }
}
exports.TaskStore = TaskStore;
