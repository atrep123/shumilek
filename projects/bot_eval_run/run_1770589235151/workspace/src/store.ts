import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';

type Task = {
  id: string;
  title: string;
  done: boolean;
  createdAt: string;
  doneAt?: string;
};

export class TaskStore {
  private filePath: string;
  private tasks: Task[];

  constructor(filePath: string) {
    this.filePath = filePath;
    this.tasks = [];
    if (fs.existsSync(this.filePath)) {
      const data = fs.readFileSync(this.filePath, 'utf8');
      this.tasks = JSON.parse(data).tasks || [];
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
    this.save();
    return task;
  }

  done(id: string): Task {
    const task = this.tasks.find(t => t.id === id);
    if (task) {
      task.done = true;
      task.doneAt = new Date().toISOString();
      this.save();
    }
    return task!;
  }

  remove(id: string): Task {
    const index = this.tasks.findIndex(t => t.id === id);
    if (index !== -1) {
      const removedTask = this.tasks[index];
      this.tasks.splice(index, 1);
      this.save();
      return removedTask;
    }
    throw new Error('Task not found');
  }

  private save() {
    fs.writeFileSync(this.filePath, JSON.stringify({ tasks: this.tasks }, null, 2));
  }
}
