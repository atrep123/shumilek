// src/modules/tasks/service.js
const { randomUUID } = require('node:crypto');

let tasksStore = [];

async function createTask(projectId, description) {
  const task = {
    id: randomUUID(),
    projectId,
    description,
    status: 'todo',
  };
  tasksStore.push(task);
  return task;
}

async function getAllTasks(projectId) {
  return tasksStore.filter(task => task.projectId === projectId);
}

async function updateTaskStatus(projectId, taskId, status) {
  const task = tasksStore.find(t => t.id === taskId && t.projectId === projectId);
  if (task) {
    task.status = status;
  }
  return task;
}

module.exports = {
  createTask,
  getAllTasks,
  updateTaskStatus,
};