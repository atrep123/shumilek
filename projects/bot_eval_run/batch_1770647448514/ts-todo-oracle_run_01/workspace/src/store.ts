import { randomUUID } from 'node:crypto';
declare const require: any;
const fs = require('node:fs');

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
    } catch (error: any) {
      if (error.code === 'ENOENT') return [];
      throw error;
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
    if (index < 0) throw new Error('Task not found');
    const task = { ...tasks[index], done: true, doneAt: new Date().toISOString() };
    tasks[index] = task;
    fs.writeFileSync(this.filePath, JSON.stringify({ tasks }, null, 2));
    return task;
  }

  remove(id: string): Task {
    const tasks = this.list();
    const index = tasks.findIndex(task => task.id === id);
    if (index < 0) throw new Error('Task not found');
    const [task] = tasks.splice(index, 1);
    fs.writeFileSync(this.filePath, JSON.stringify({ tasks }, null, 2));
    return task;
  }
}

export { TaskStore };
