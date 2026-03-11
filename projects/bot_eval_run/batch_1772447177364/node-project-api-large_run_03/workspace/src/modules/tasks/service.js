// src/modules/tasks/service.js
const { randomUUID } = require('node:crypto');
const tasksStore = [];

async function getTasksByProjectId(projectId, status) {
  let tasks = tasksStore.filter(t => t.projectId === projectId);
  if (status) {
    tasks = tasks.filter(t => t.status === status);
  }
  return tasks;
}

async function createTask(projectId, title) {
  const task = { id: randomUUID(), projectId, title, status: 'todo' };
  tasksStore.push(task);
  return task;
}

async function updateTaskStatus(projectId, taskId, status) {
  const task = tasksStore.find(t => t.id === taskId && t.projectId === projectId);
  if (task) {
    task.status = status;
  }
  return task;
}

module.exports = {
  getTasksByProjectId,
  createTask,
  updateTaskStatus,
};
