// src/modules/tasks/service.js
const { randomUUID } = require('node:crypto');
const tasksStore = {};

async function getTasks(projectId, status) {
  if (!tasksStore[projectId]) {
    return [];
  }
  let tasks = tasksStore[projectId];
  if (status === 'done') {
    tasks = tasks.filter(task => task.status === 'done');
  }
  return tasks;
}

async function updateTaskStatus(projectId, taskId, status) {
  if (!tasksStore[projectId]) {
    return null;
  }
  const taskIndex = tasksStore[projectId].findIndex(task => task.id === taskId);
  if (taskIndex === -1) {
    return null;
  }
  tasksStore[projectId][taskIndex].status = status;
  return tasksStore[projectId][taskIndex];
}

module.exports = {
  getTasks,
  updateTaskStatus,
};
