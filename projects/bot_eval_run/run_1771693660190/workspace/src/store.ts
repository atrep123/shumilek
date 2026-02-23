import { readFileSync, writeFileSync } from 'fs';

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
      const data = readFileSync(this.filePath, 'utf-8');
      return JSON.parse(data).tasks || [];
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        writeFileSync(this.filePath, '{}', 'utf-8');
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
    writeFileSync(this.filePath, JSON.stringify({ tasks }), 'utf-8');

    return task;
  }
}

export default TaskStore;