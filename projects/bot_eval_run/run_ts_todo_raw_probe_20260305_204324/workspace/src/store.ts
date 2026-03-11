declare const require: any;
import { randomUUID as uuidv4 } from 'node:crypto';
const fs = require("node:fs");
import path from 'node:path';

export class Task {
  id: string;
  title: string;
  done: boolean;
  createdAt: string;
  doneAt?: string;

  constructor(title: string) {
    this.id = uuidv4();
    this.title = title;
    this.done = false;
    this.createdAt = new Date().toISOString();
  }
}

export class TaskStore {
  filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify({ tasks: [] }));
    }
  }

  list(): Task[] {
    const data = fs.readFileSync(this.filePath, 'utf8');
    return JSON.parse(data).tasks;
  }

  add(title: string): Task {
    const task = new Task(title);
    const data = fs.readFileSync(this.filePath, 'utf8');
    const tasks = JSON.parse(data).tasks;
    tasks.push(task);
    fs.writeFileSync(this.filePath, JSON.stringify({ tasks: tasks }));
    return task;
  }

  done(id: string): Task {
    const data = fs.readFileSync(this.filePath, 'utf8');
    const tasks = JSON.parse(data).tasks;
    const task = tasks.find(t => t.id === id);
    if (task) {
      task.done = true;
      task.doneAt = new Date().toISOString();
      fs.writeFileSync(this.filePath, JSON.stringify({ tasks: tasks }));
    }
    return task;
  }

  remove(id: string): Task {
    const data = fs.readFileSync(this.filePath, 'utf8');
    const tasks = JSON.parse(data).tasks;
    const taskIndex = tasks.findIndex(t => t.id === id);
    if (taskIndex !== -1) {
      const removedTask = tasks.splice(taskIndex, 1)[0];
      fs.writeFileSync(this.filePath, JSON.stringify({ tasks: tasks }));
      return removedTask;
    }
    return null;
  }
}
