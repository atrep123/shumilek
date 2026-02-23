declare const require: any;
declare const process: any;

const fs = require("node:fs");
const path = require("node:path");

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
    this.filePath = path.resolve(process.cwd(), filePath);
    this.loadTasks();
  }

  list(): Task[] {
    return [...this.tasks];
  }

  add(title: string): Task {
    const task: Task = {
      id: Math.random().toString(36).substr(2, 9),
      title,
      done: false,
      createdAt: new Date().toISOString()
    };
    this.tasks.push(task);
    this.saveTasks();
    return task;
  }

  done(id: string): Task {
    const task = this.tasks.find(t => t.id === id);
    if (!task) throw new Error(`Task with ID ${id} not found`);
    task.done = true;
    task.doneAt = new Date().toISOString();
    this.saveTasks();
    return task;
  }

  remove(id: string): Task {
    const index = this.tasks.findIndex(t => t.id === id);
    if (index < 0) throw new Error(`Task with ID ${id} not found`);
    const [removedTask] = this.tasks.splice(index, 1);
    this.saveTasks();
    return removedTask;
  }

  private loadTasks(): void {
    try {
      const data = fs.readFileSync(this.filePath, 'utf8');
      const parsedData = JSON.parse(data);
      if (Array.isArray(parsedData.tasks)) {
        this.tasks = parsedData.tasks.map((t: Task) => ({ ...t }));
      }
    } catch {}
  }

  private saveTasks(): void {
    fs.writeFileSync(this.filePath, JSON.stringify({ tasks: this.tasks }), 'utf8');
  }
}

export { TaskStore };
