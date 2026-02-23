import crypto from 'node:crypto';
export interface Task {
id: string;
title: string;
done: boolean;
createdAt: string;
optional doneAt?: string;
}
export interface TaskStore {
list(): Task[];
add(title: string): Task;
don(id: string): Task;
remove(id: string): Task;
}
export class InMemoryTaskStore implements TaskStore {
tasks: Task[] = [];
constructor(private filePath: string) {}
// ... (remaining part of the file remains unchanged)
