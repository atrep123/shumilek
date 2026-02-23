export class TaskStore {
  private tasks: { id: string; title: string; completed: boolean }[] = [];

  constructor(private filePath: string) {}

  list(): { id: string; title: string; completed: boolean }[] {
    try {
      const data = fs.readFileSync(this.filePath, 'utf-8');
      this.tasks = JSON.parse(data);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.tasks = [];
    }
    return this.tasks;
  }

  add(title: string): { id: string; title: string; completed: boolean } {
    const task = { id: Date.now().toString(), title, completed: false };
    this.tasks.push(task);
    this.save();
    return task;
  }

  done(id: string): { id: string; title: string; completed: boolean } | null {
    const task = this.tasks.find(t => t.id === id);
    if (task) {
      task.completed = true;
      this.save();
    }
    return task || null;
  }

  remove(id: string): { id: string; title: string; completed: boolean } | null {
    const index = this.tasks.findIndex(t => t.id === id);
    if (index !== -1) {
      const removedTask = this.tasks.splice(index, 1)[0];
      this.save();
      return removedTask;
    }
    return null;
  }

  private save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.tasks, null, 2));
  }
}