import { readFileSync, writeFileSync } from 'fs';
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
    this.filePath = filePath;
  }

  private readTasks(): Task[] {
    try {
      const data = readFileSync(this.filePath, 'utf-8');
      return JSON.parse(data);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  private writeTasks(tasks: Task[]): void {
    writeFileSync(this.filePath, JSON.stringify(tasks, null, 2));
  }

  list(): Task[] {
    return this.readTasks();
  }

  add(title: string): Task {
    const task: Task = {
      id: randomUUID(),
      title,
      done: false,
      createdAt: new Date().toISOString()
    };
    const tasks = this.readTasks();
    tasks.push(task);
    this.writeTasks(tasks);
    return task;
  }

  done(id: string): Task {
    let tasks = this.readTasks();
    const taskIndex = tasks.findIndex(t => t.id === id);
    if (taskIndex !== -1) {
      tasks[taskIndex].done = true;
      tasks[taskIndex].doneAt = new Date().toISOString();
      this.writeTasks(tasks);
      return tasks[taskIndex];
    }
    throw new Error('Task not found');
  }

  remove(id: string): Task {
    let tasks = this.readTasks();
    const taskIndex = tasks.findIndex(t => t.id === id);
    if (taskIndex !== -1) {
      const removedTask = tasks.splice(taskIndex, 1)[0];
      this.writeTasks(tasks);
      return removedTask;
    }
    throw new Error('Task not found');
  }
}

export { TaskStore };
