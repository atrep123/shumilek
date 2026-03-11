const fs = require('node:fs');
const crypto = require('node:crypto');

export type Task = {
  id: string;
  title: string;
  done: boolean;
  createdAt: string;
  doneAt?: string;
};

type TaskFile = { tasks: Task[] };

export class TaskStore {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  private readData(): TaskFile {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      const tasks = Array.isArray(parsed?.tasks) ? parsed.tasks : [];
      return { tasks };
    } catch (error: any) {
      if (error?.code === 'ENOENT') return { tasks: [] };
      throw error;
    }
  }

  private writeData(file: TaskFile): void {
    fs.writeFileSync(this.filePath, JSON.stringify(file, null, 2), 'utf8');
  }

  list(): Task[] {
    return this.readData().tasks;
  }

  add(title: string): Task {
    const file = this.readData();
    const task: Task = {
      id: crypto.randomUUID(),
      title,
      done: false,
      createdAt: new Date().toISOString()
    };
    file.tasks.push(task);
    this.writeData(file);
    return task;
  }

  done(id: string): Task {
    const file = this.readData();
    const idx = file.tasks.findIndex((t: Task) => t.id === id);
    if (idx < 0) throw new Error('Task not found');
    file.tasks[idx].done = true;
    file.tasks[idx].doneAt = new Date().toISOString();
    this.writeData(file);
    return file.tasks[idx];
  }

  remove(id: string): Task {
    const file = this.readData();
    const idx = file.tasks.findIndex((t: Task) => t.id === id);
    if (idx < 0) throw new Error('Task not found');
    const [removed] = file.tasks.splice(idx, 1);
    this.writeData(file);
    return removed;
  }
}
