// src/modules/tasks/service.js
const { randomUUID } = require('node:crypto');
const tasksStore = [];

async function getTasksByProjectId(projectId) {
  return tasksStore.filter(t => t.projectId === projectId);
}

async function createTask(projectId, title) {
  const task = {
    id: randomUUID(),
    projectId,
    title,
    status: 'todo',
    createdAt: new Date().toISOString()
  };
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
  updateTaskStatus
};
module.exports.getAllTasks = module.exports.getTasksByProjectId;
