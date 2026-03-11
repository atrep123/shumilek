declare const require: any;
const fs = require("node:fs");
const path = require("node:path");
import { v4 as uuidv4 } from 'uuid';

interface Task {
  id: string;
  title: string;
  completed: boolean;
}

export class TaskStore {
  private dataFilePath: string;

  constructor(dataFilePath: string) {
    this.dataFilePath = dataFilePath;
  }

  async addTask(title: string): Promise<void> {
    const tasks: Task[] = this.readTasks();
    tasks.push({ id: uuidv4(), title, completed: false });
    this.writeTasks(tasks);
  }

  async listTasks(): Promise<Task[]> {
    return this.readTasks();
  }

  async markTaskAsDone(id: string): Promise<void> {
    const tasks: Task[] = this.readTasks();
    const task = tasks.find(t => t.id === id);
    if (task) {
      task.completed = true;
      this.writeTasks(tasks);
    }
  }

  async removeTask(id: string): Promise<void> {
    const tasks: Task[] = this.readTasks();
    const updatedTasks = tasks.filter(t => t.id !== id);
    this.writeTasks(updatedTasks);
  }

  private readTasks(): Task[] {
    const data = fs.readFileSync(this.dataFilePath, 'utf-8');
    return JSON.parse(data).tasks || [];
  }

  private writeTasks(tasks: Task[]): void {
    fs.writeFileSync(this.dataFilePath, JSON.stringify({ tasks }, null, 2));
  }
}
