import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

interface Task {
  id: string;
  title: string;
  done: boolean;
  createdAt: string;
  doneAt?: string;
}

class TaskStore {
  private filePath: string;
  private tasks: Task[] = [];

  constructor(filePath: string) {
    this.filePath = filePath;
    try {
      const data = readFileSync(this.filePath, 'utf8');
      this.tasks = JSON.parse(data).tasks || [];
    } catch (error: any) {}
  }

  list(): Task[] {
    return this.tasks;
  }

  add(title: string): Task {
    const task: Task = { id: randomUUID(), title, done: false, createdAt: new Date().toISOString() };
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
    if (index >= 0) {
      const [task] = this.tasks.splice(index, 1);
      this.save();
      return task;
    }
    throw new Error('Task not found');
  }

  private save(): void {
    writeFileSync(this.filePath, JSON.stringify({ tasks: this.tasks }, null, 2));
  }
}

export { TaskStore };
