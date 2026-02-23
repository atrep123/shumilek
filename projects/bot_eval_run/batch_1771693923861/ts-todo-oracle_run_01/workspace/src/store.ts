declare const require: any;
declare const process: any;
const fs = require('node:fs');
const crypto = require('node:crypto');

interface Task {
  id: string,
  title: string,
  done: boolean,
  createdAt: string,
  doneAt?: string
}

class TaskStore {
  private tasks: Task[];
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.tasks = [];
    this.load();
  }

  load(): void {
    try {
      const data = fs.readFileSync(this.filePath, 'utf-8');
      this.tasks = JSON.parse(data);
    } catch (error) {
      console.error('Failed to load tasks:', error.message);
    }
  }

  save(): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.tasks, null, 2));
    } catch (error) {
      console.error('Failed to save tasks:', error.message);
    }
  }

  add(title: string): Task {
    const task = { id: crypto.randomUUID(), title, done: false, createdAt: new Date().toISOString() };
    this.tasks.push(task);
    this.save();
    return task;
  }

  list(): Task[] {
    return this.tasks;
  }

  markDone(id: string): void {
    const task = this.tasks.find(t => t.id === id);
    if (task) {
      task.done = true;
      task.doneAt = new Date().toISOString();
      this.save();
    } else {
      throw new Error(`Task with ID ${id} not found`);
    }
  }

  remove(id: string): void {
    const index = this.tasks.findIndex(t => t.id === id);
    if (index !== -1) {
      this.tasks.splice(index, 1);
      this.save();
    } else {
      throw new Error(`Task with ID ${id} not found`);
    }
  }
}

export { TaskStore };
