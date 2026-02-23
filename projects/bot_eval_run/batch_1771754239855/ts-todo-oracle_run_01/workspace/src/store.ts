declare const require: any;
declare const process: any;
const fs = require('node:fs');
const crypto = require('node:crypto');

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
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  add(title: string): Task {
    const task: Task = {
      id: crypto.randomUUID(),
      title,
      done: false,
      createdAt: new Date().toISOString()
    };
    const tasks = this.list();
    tasks.push(task);
    fs.writeFileSync(this.filePath, JSON.stringify({ tasks }, null, 2));
    return task;
  }

  done(id: string): Task {
    let tasks = this.list();
    const taskIndex = tasks.findIndex(t => t.id === id);
    if (taskIndex !== -1) {
      tasks[taskIndex].done = true;
      tasks[taskIndex].doneAt = new Date().toISOString();
      fs.writeFileSync(this.filePath, JSON.stringify({ tasks }, null, 2));
      return tasks[taskIndex];
    }
    throw new Error('Task not found');
  }

  remove(id: string): Task {
    let tasks = this.list();
    const taskIndex = tasks.findIndex(t => t.id === id);
    if (taskIndex !== -1) {
      const removedTask = tasks.splice(taskIndex, 1)[0];
      fs.writeFileSync(this.filePath, JSON.stringify({ tasks }, null, 2));
      return removedTask;
    }
    throw new Error('Task not found');
  }
}

export { TaskStore };
