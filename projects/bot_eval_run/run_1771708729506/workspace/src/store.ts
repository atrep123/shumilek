import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

interface Task {
  id: string;
  title: string;
  completed: boolean;
}

class TaskStore {
  private filePath: string;
  private tasks: Task[] = [];

  constructor(filePath: string) {
    this.filePath = join(__dirname, filePath);
    this.loadTasks();
  }

  private loadTasks() {
    try {
      const data = readFileSync(this.filePath, 'utf-8');
      this.tasks = JSON.parse(data) || [];
    } catch (error) {
      // If the file doesn't exist or is empty, tasks will remain an empty array
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  private saveTasks() {
    writeFileSync(this.filePath, JSON.stringify(this.tasks, null, 2));
  }

  list(): Task[] {
    return this.tasks;
  }

  add(title: string): Task {
    const task: Task = {
      id: randomUUID(),
      title,
      completed: false,
    };
    this.tasks.push(task);
    this.saveTasks();
    return task;
  }

  done(id: string): Task | null {
    const task = this.tasks.find(t => t.id === id);
    if (task) {
      task.completed = true;
      this.saveTasks();
    }
    return task || null;
  }

  remove(id: string): Task | null {
    const index = this.tasks.findIndex(t => t.id === id);
    if (index !== -1) {
      const removedTask = this.tasks.splice(index, 1)[0];
      this.saveTasks();
      return removedTask;
    }
    return null;
  }
}

export { TaskStore };