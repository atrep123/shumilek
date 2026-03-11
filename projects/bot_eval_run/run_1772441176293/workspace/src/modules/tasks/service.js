const { randomUUID } = require('node:crypto');
const tasks = [];

export function createTask(projectId, { name }) {
  const task = { id: randomUUID(), projectId, name, status: 'todo' };
  tasks.push(task);
  return task;
}

export function updateTaskStatus(projectId, taskId, status) {
  const taskIndex = tasks.findIndex(task => task.id === taskId && task.projectId === projectId);
  if (taskIndex === -1) return null;
  tasks[taskIndex].status = status;
  return tasks[taskIndex];
}

export function getTasksByProjectId(projectId) {
  return tasks.filter(task => task.projectId === projectId);
}

class BadRequestError extends Error {
  constructor(message) {
    super(message); 
    this.code = 'BadRequest';
  }
}

export { BadRequestError };
