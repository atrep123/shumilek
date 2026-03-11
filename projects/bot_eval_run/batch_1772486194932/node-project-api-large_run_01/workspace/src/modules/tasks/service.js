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

async function createTask(projectId, description) {
  const task = { id: randomUUID(), projectId, description, status: 'todo' };
  tasksStore.push(task);
  return task;
}

async function updateTaskStatus(projectId, taskId, status) {
  const task = tasksStore.find(t => t.projectId === projectId && t.id === taskId);
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
module.exports.getAllTasks = module.exports.getTasksByProjectId;
