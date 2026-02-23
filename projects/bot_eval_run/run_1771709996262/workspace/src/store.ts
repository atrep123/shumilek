import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

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
    this.filePath = join(__dirname, '..', filePath);
  }

  list(): Task[] {
    try {
      const data = readFileSync(this.filePath, 'utf-8');
      return JSON.parse(data).tasks || [];
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        writeFileSync(this.filePath, JSON.stringify({ tasks: [] }, null, 2));
        return [];
      }
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
    const tasks = this.list();
    tasks.push(task);
    writeFileSync(this.filePath, JSON.stringify({ tasks }, null, 2));
    return task;
  }

  done(id: string): Task {
    let tasks = this.list();
    const task = tasks.find(t => t.id === id);
    if (task) {
      task.done = true;
      task.doneAt = new Date().toISOString();
      writeFileSync(this.filePath, JSON.stringify({ tasks }, null, 2));
    }
    return task || { id, title: '', done: false, createdAt: '' };
  }

  remove(id: string): void {
    let tasks = this.list();
    tasks = tasks.filter(t => t.id !== id);
    writeFileSync(this.filePath, JSON.stringify({ tasks }, null, 2));
  }
}

export { TaskStore };