declare const require: any;
declare const process: any;
const fs = require('node:fs');
const path = require('node:path');

export interface Task {
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
    if (fs.existsSync(filePath)) {
      try {
        const data = fs.readFileSync(filePath, 'utf8');
        this.tasks = JSON.parse(data) || [];
      } catch (e) {
        console.error('Failed to read task file:', e);
      }
    }
  }

  list(): Task[] {
    return [...this.tasks];
  }

  add(title: string): Task {
    const newTask = {
      id: Date.now().toString(),
      title,
      done: false,
      createdAt: new Date().toISOString()
    };
    this.tasks.push(newTask);
    this.save();
    return newTask;
  }

  done(id: string): Task | undefined {
    const task = this.tasks.find(t => t.id === id);
    if (task && !task.done) {
      task.done = true;
      task.doneAt = new Date().toISOString();
      this.save();
    }
    return task;
  }

  remove(id: string): Task | undefined {
    const index = this.tasks.findIndex(t => t.id === id);
    if (index !== -1) {
      const removedTask = this.tasks.splice(index, 1)[0];
      this.save();
      return removedTask;
    }
    return undefined;
  }

  private save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify({ tasks: this.tasks }, null, 2));
    } catch (e) {
      console.error('Failed to write task file:', e);
    }
  }
}

export { TaskStore };
