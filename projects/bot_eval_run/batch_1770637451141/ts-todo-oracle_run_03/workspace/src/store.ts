// src/store.ts

declare const require: any;
const fs = require('node:fs');
const crypto = require('node:crypto');

type Task = {
  id: string,
  title: string,
  done: boolean,
  createdAt: string,
  doneAt?: string
};

class TaskStore {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  list(): Task[] {
    if (!fs.existsSync(this.filePath)) return [];
    const data = fs.readFileSync(this.filePath, 'utf8');
    return JSON.parse(data).tasks || [];
  }

  add(title: string): Task {
    const task: Task = {
      id: crypto.randomUUID(),
      title,
      done: false,
      createdAt: new Date().toISOString()
    };
    let tasks = this.list();
    tasks.push(task);
    fs.writeFileSync(this.filePath, JSON.stringify({ tasks }, null, 2));
    return task;
  }

  done(id: string): Task {
    let tasks = this.list();
    const taskIndex = tasks.findIndex(t => t.id === id);
    if (taskIndex === -1) throw new Error('Task not found');
    const task = tasks[taskIndex];
    task.done = true;
    task.doneAt = new Date().toISOString();
    fs.writeFileSync(this.filePath, JSON.stringify({ tasks }, null, 2));
    return task;
  }

  remove(id: string): Task {
    let tasks = this.list();
    const taskIndex = tasks.findIndex(t => t.id === id);
    if (taskIndex === -1) throw new Error('Task not found');
    const task = tasks[taskIndex];
    tasks.splice(taskIndex, 1);
    fs.writeFileSync(this.filePath, JSON.stringify({ tasks }, null, 2));
    return task;
  }
}

export { TaskStore };
