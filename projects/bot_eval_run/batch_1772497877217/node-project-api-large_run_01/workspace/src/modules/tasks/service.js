// src/modules/tasks/service.js
const { randomUUID } = require('node:crypto');

let tasksStore = [];

const createTask = (projectId, status) => {
  const task = { id: randomUUID(), projectId, status };
  tasksStore.push(task);
  return task;
};

const getTasksByProjectId = (projectId) => {
  return tasksStore.filter(t => t.projectId === projectId);
};

const updateTaskStatus = (projectId, taskId, status) => {
  const taskIndex = tasksStore.findIndex(t => t.id === taskId && t.projectId === projectId);
  if (taskIndex !== -1) {
    tasksStore[taskIndex].status = status;
    return tasksStore[taskIndex];
  }
  return null;
};

module.exports = { createTask, getTasksByProjectId, updateTaskStatus };