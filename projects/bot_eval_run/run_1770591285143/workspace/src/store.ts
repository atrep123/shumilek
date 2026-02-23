import { Task, TaskStore } from './store';

export class TaskStore {
  private filePath: string;
  private tasks: Task[];

  constructor(filePath: string) {
    this.filePath = filePath;
    this.tasks = this.loadTasks();
  }

  private loadTasks(): Task[] {
    if (!fs.existsSync(this.filePath)) return [];
    const data = fs.readFileSync(this.filePath, 'utf8');
    return JSON.parse(data).tasks || [];
  }

  list(): Task[] {
    return this.tasks;
  }

  add(title: string): Task {
    const task: Task = { id: crypto.randomUUID(), title, done: false, createdAt: new Date().toISOString() };
    this.tasks.push(task);
    this.saveTasks();
    return task;
  }

  done(id: string): Task {
    const task = this.tasks.find(t => t.id === id);
    if (task) {
      task.done = true;
      task.doneAt = new Date().toISOString();
      this.saveTasks();
    }
    return task!;
  }

  remove(id: string): Task {
    const index = this.tasks.findIndex(t => t.id === id);
    if (index !== -1) {
      const removedTask = this.tasks.splice(index, 1)[0];
      this.saveTasks();
      return removedTask;
    }
    throw new Error('Task not found');
  }

  private saveTasks() {
    fs.writeFileSync(this.filePath, JSON.stringify({ tasks: this.tasks }, null, 2));
  }
}
