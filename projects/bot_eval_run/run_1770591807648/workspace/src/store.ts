import { v4 as uuidv4 } from 'uuid';
import * as fs from 'path';

declare const require: any;
const crypto = require('crypto');

export class Task {
  id: string;
  title: string;
  done: boolean;
  createdAt: string;
  doneAt?: string;
}

export class TaskStore {
  filePath: string;
  tasks: Task[];

  constructor(filePath: string) {
    this.filePath = filePath;
    if (fs.existsSync(this.filePath)) {
      const data = fs.readFileSync(this.filePath, 'utf8');
      this.tasks = JSON.parse(data).tasks || [];
    } else {
      this.tasks = [];
    }
  }

  list(): Task[] {
    return this.tasks;
  }

  add(title: string): Task {
    const task: Task = {
      id: uuidv4(),
      title,
      done: false,
      createdAt: new Date().toISOString()
    };
    this.tasks.push(task);
    fs.writeFileSync(this.filePath, JSON.stringify({ tasks: this.tasks }));
    return task;
  }

  done(id: string): Task {
    const task = this.tasks.find(t => t.id === id);
    if (task) {
      task.done = true;
      task.doneAt = new Date().toISOString();
      fs.writeFileSync(this.filePath, JSON.stringify({ tasks: this.tasks }));
    }
    return task!;
  }

  remove(id: string): Task {
    const index = this.tasks.findIndex(t => t.id === id);
    if (index !== -1) {
      const removedTask = this.tasks[index];
      this.tasks.splice(index, 1);
      fs.writeFileSync(this.filePath, JSON.stringify({ tasks: this.tasks }));
      return removedTask;
    }
    throw new Error('Task not found');
  }
}
