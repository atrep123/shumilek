import { readFileSync, writeFileSync } from 'node:fs';

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
      const data = readFileSync(this.filePath, 'utf8');
      return JSON.parse(data).tasks || [];
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        writeFileSync(this.filePath, '{}', 'utf8');
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
      createdAt: new Date().toISOString(),
    };
    const tasks = this.list();
    tasks.push(task);
    writeFileSync(this.filePath, JSON.stringify({ tasks }), 'utf8');
    return task;
  }

  update(id: string, updates: Partial<Task>): Task | null {
    let tasks = this.list();
    const index = tasks.findIndex(task => task.id === id);
    if (index !== -1) {
      tasks[index] = { ...tasks[index], ...updates };
      writeFileSync(this.filePath, JSON.stringify({ tasks }), 'utf8');
      return tasks[index];
    }
    return null;
  }

  remove(id: string): boolean {
    let tasks = this.list();
    const index = tasks.findIndex(task => task.id === id);
    if (index !== -1) {
      tasks.splice(index, 1);
      writeFileSync(this.filePath, JSON.stringify({ tasks }), 'utf8');
      return true;
    }
    return false;
  }
}

export default TaskStore;