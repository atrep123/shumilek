import { randomUUID } from 'node:crypto';
import { sendError } from '../../lib/errors.js';

const tasks = {};

export const createTask = (title) => {
  if (!title) return null;
  const id = randomUUID();
  tasks[id] = { id, title, status: 'todo' };
  return { id, title, status: 'todo' };
};

export const getTasksByProjectId = (projectId) => {
  return Object.values(tasks).filter(task => task.projectId === projectId);
};

export const updateTaskStatus = (projectId, taskId, status) => {
  if (!['todo', 'done'].includes(status)) return null;
  tasks[taskId].status = status;
  return { id: taskId, title: tasks[taskId].title, status };
};
