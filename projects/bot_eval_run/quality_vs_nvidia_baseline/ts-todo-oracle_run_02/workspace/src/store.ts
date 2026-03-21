declare const require: any;
const { randomUUID: uuidv4 } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
export interface Task {
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
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, JSON.stringify({ tasks: [] }));
    }
  }

  list(): Task[] {
    const data = fs.readFileSync(this.filePath, 'utf8');
    return JSON.parse(data).tasks;
  }

  add(title: string): Task {
    const tasks = this.list();
    const task: Task = {
      id: uuidv4(),
      title,
      done: false,
      createdAt: new Date().toISOString()
    };
    tasks.push(task);
    fs.writeFileSync(this.filePath, JSON.stringify({ tasks }));
    return task;
  }

  done(id: string): Task | null {
    const tasks = this.list();
    const taskIndex = tasks.findIndex(t => t.id === id);
    if (taskIndex !== -1) {
      tasks[taskIndex].done = true;
      tasks[taskIndex].doneAt = new Date().toISOString();
      fs.writeFileSync(this.filePath, JSON.stringify({ tasks }));
    }
    return tasks[taskIndex];
  }

  remove(id: string): Task | null {
    const tasks = this.list();
    const taskIndex = tasks.findIndex(t => t.id === id);
    if (taskIndex !== -1) {
      const removedTask = tasks[taskIndex];
      tasks.splice(taskIndex, 1);
      fs.writeFileSync(this.filePath, JSON.stringify({ tasks }));
      return removedTask;
    }
    throw new Error('Task not found');
  }
}
