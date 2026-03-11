declare const require: any;
const fs = require("node:fs");
const crypto = require("node:crypto");

interface Task {
  id: string;
  title: string;
  done: boolean;
  createdAt: string;
  doneAt?: string;
}

export class TaskStore {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify({ tasks: [] }));
    }
  }

  list(): Task[] {
    const data = fs.readFileSync(this.filePath, 'utf-8');
    return JSON.parse(data).tasks;
  }

  add(title: string): Task {
    const tasks = this.list();
    const task = { id: crypto.randomUUID(), title, done: false, createdAt: new Date().toISOString() };
    tasks.push(task);
    fs.writeFileSync(this.filePath, JSON.stringify({ tasks }));
    return task;
  }

  done(id: string): Task | undefined {
    const tasks = this.list();
    const task = tasks.find(t => t.id === id);
    if (task) {
      task.done = true;
      task.doneAt = new Date().toISOString();
      fs.writeFileSync(this.filePath, JSON.stringify({ tasks }));
    }
    return task;
  }

  remove(id: string): boolean {
    let tasks = this.list();
    tasks = tasks.filter(t => t.id !== id);
    fs.writeFileSync(this.filePath, JSON.stringify({ tasks }));
    return true;
  }
}
