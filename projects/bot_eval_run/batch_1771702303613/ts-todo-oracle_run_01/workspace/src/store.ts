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
    } catch (error) {
      return [];
    }
  }

  private writeTasks(tasks: Task[]): void {
    writeFileSync(this.filePath, JSON.stringify(tasks, null, 2));
  }

  add(title: string): Task {
    const tasks = this.readTasks();
    const newTask: Task = {
      id: randomUUID(),
      title,
      done: false,
      createdAt: new Date().toISOString()
    };
    tasks.push(newTask);
    this.writeTasks(tasks);
    return newTask;
  }

  list(): Task[] {
    return this.readTasks();
  }

  markAsDone(id: string): void {
    const tasks = this.readTasks();
    const task = tasks.find(t => t.id === id);
    if (task) {
      task.done = true;
      task.doneAt = new Date().toISOString();
      this.writeTasks(tasks);
    }
  }

  remove(id: string): void {
    let tasks = this.readTasks();
    tasks = tasks.filter(t => t.id !== id);
    this.writeTasks(tasks);
  }
}

export default TaskStore;
