const { readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { randomUUID } = require("node:crypto");

declare const require: any;
declare const process: any;

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

  private readTasks(): Task[] {
    try {
      const data = readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(data);
      return Array.isArray(parsed?.tasks) ? parsed.tasks : (Array.isArray(parsed) ? parsed : []);
} catch (error: any) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  private writeTasks(tasks: Task[]): void {
    writeFileSync(this.filePath, JSON.stringify({ tasks }, null, 2));
  }

  list(): Task[] {
    return this.readTasks();
  }

  add(title: string): Task {
    const task: Task = {
      id: randomUUID(),
      title,
      done: false,
      createdAt: new Date().toISOString(),
    };
    const tasks = this.readTasks();
    tasks.push(task);
    this.writeTasks(tasks);
    return task;
  }

  done(id: string): Task {
    const tasks = this.readTasks();
    const task = tasks.find(t => t.id === id);
    if (task) {
      task.done = true;
      task.doneAt = new Date().toISOString();
      this.writeTasks(tasks);
    }
    if (!task) throw new Error('Task not found');
    return task;
  }

  remove(id: string): Task {
    const tasks = this.readTasks();
    const taskIndex = tasks.findIndex(t => t.id === id);
    if (taskIndex !== -1) {
      const removedTask = tasks.splice(taskIndex, 1)[0];
      this.writeTasks(tasks);
      return removedTask;
    }
    return { id, title: '', done: false, createdAt: '' };
  }
}

export { TaskStore };
