declare const require: any;
declare const fs = require('node:fs');
declare const randomUUID = require('node:crypto').randomUUID;

declare interface Task {
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
      id: randomUUID(),
      title,
      done: false,
      createdAt: new Date().toISOString()
    };
    this.tasks.push(task);
    this.save();
    return task;
  }

  done(id: string): Task | undefined {
    const task = this.tasks.find(t => t.id === id);
    if (task) {
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
    fs.writeFileSync(this.filePath, JSON.stringify({ tasks: this.tasks }, null, 2));
  }
}

export { TaskStore };