import { randomUUID } from 'node:crypto';
declare const require: any;
const fs = require('node:fs');
const path = require('node:path');

interface Task {
  id: string;
  title: string;
  done: boolean;
  createdAt: string;
  doneAt?: string;
}

class TaskStore {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  list(): Task[] {
    try {
      const data = fs.readFileSync(this.filePath, 'utf8');
      return JSON.parse(data).tasks || [];
    } catch (e) {
      return [];
    }
  }

  add(title: string): Task {
    const task: Task = {
      id: randomUUID(),
      title,
      done: false,
      createdAt: new Date().toISOString()
    };
    const tasks = [...this.list(), task];
    fs.writeFileSync(this.filePath, JSON.stringify({ tasks }, null, 2));
    return task;
  }

  done(id: string): Task {
    const tasks = this.list();
    const index = tasks.findIndex(task => task.id === id);
    if (index >= 0) {
      tasks[index].done = true;
      tasks[index].doneAt = new Date().toISOString();
      fs.writeFileSync(this.filePath, JSON.stringify({ tasks }, null, 2));
      return tasks[index];
    }
    throw new Error('Task not found');
  }

  remove(id: string): Task {
    const tasks = this.list();
    const index = tasks.findIndex(task => task.id === id);
    if (index >= 0) {
      const removedTask = tasks.splice(index, 1)[0];
      fs.writeFileSync(this.filePath, JSON.stringify({ tasks }, null, 2));
      return removedTask;
    }
    throw new Error('Task not found');
  }
}

export { TaskStore };
