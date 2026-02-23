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
      const data = readFileSync(this.filePath, 'utf8');
      return JSON.parse(data).tasks || [];
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  private writeTasks(tasks: Task[]): void {
    const data = JSON.stringify({ tasks }, null, 2);
    writeFileSync(this.filePath, data);
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
    const task = tasks.find(t => t.id === id);
    if (task) {
      task.done = true;
      task.doneAt = new Date().toISOString();
      this.writeTasks(tasks);
    }
    return task || { id, title: '', done: false, createdAt: '' };
  }

  remove(id: string): Task {
    let tasks = this.readTasks();
    const taskIndex = tasks.findIndex(t => t.id === id);
    if (taskIndex !== -1) {
      const [task] = tasks.splice(taskIndex, 1);
      this.writeTasks(tasks);
      return task;
    }
    return { id, title: '', done: false, createdAt: '' };
  }
}

export { TaskStore };