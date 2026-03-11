// src/modules/tasks/service.js
const { randomUUID } = require('node:crypto');

let tasksStore = [];

const createTask = (projectId, description) => {
  const task = { id: randomUUID(), projectId, description, status: 'todo' };
  tasksStore.push(task);
  return task;
};

const getTasksByProjectId = (projectId) => {
  return tasksStore.filter(t => t.projectId === projectId);
};

const updateTaskStatus = (projectId, taskId, status) => {
  const task = tasksStore.find(t => t.id === taskId && t.projectId === projectId);
  if (task) {
    task.status = status;
  }
  return task;
};

module.exports = { createTask, getTasksByProjectId, updateTaskStatus };