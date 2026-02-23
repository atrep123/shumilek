import { randomUUID as uuidv4 } from 'node:crypto';
import fs from 'node:fs';

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
  }

  list(): Task[] {
    if (!fs.existsSync(this.filePath)) return [];
    const data = fs.readFileSync(this.filePath, 'utf8');
    return JSON.parse(data).tasks || [];
  }

  add(title: string): Task {
    const task = new Task(title);
    const tasks = this.list();
    tasks.push(task);
    fs.writeFileSync(this.filePath, JSON.stringify({ tasks }, null, 2));
    return task;
  }

  done(id: string): Task {
    const tasks = this.list();
    const taskIndex = tasks.findIndex(t => t.id === id);
    if (taskIndex !== -1) {
      tasks[taskIndex].done = true;
      tasks[taskIndex].doneAt = new Date().toISOString();
      fs.writeFileSync(this.filePath, JSON.stringify({ tasks }, null, 2));
    }
    return tasks[taskIndex];
  }

  remove(id: string): Task {
    const tasks = this.list();
    const taskIndex = tasks.findIndex(t => t.id === id);
    if (taskIndex !== -1) {
      const removedTask = tasks[taskIndex];
      tasks.splice(taskIndex, 1);
      fs.writeFileSync(this.filePath, JSON.stringify({ tasks }, null, 2));
      return removedTask;
    }
    throw new Error('Task not found');
  }
}
