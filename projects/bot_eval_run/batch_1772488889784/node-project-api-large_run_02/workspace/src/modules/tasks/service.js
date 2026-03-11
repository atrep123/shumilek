// src/modules/tasks/service.js
const { randomUUID } = require('node:crypto');
const errors = require('../../lib/errors');

let tasksStore = [];

function getTasks(projectId, statusFilter) {
  const projectTasks = tasksStore.filter(task => task.projectId === projectId);
  if (statusFilter) {
    return projectTasks.filter(task => task.status === statusFilter);
  }
  return projectTasks;
}

function updateTask(projectId, taskId, newStatus) {
  const taskIndex = tasksStore.findIndex(task => task.projectId === projectId && task.id === taskId);
  if (taskIndex === -1) {
    errors.sendError(res, 404, 'NOT_FOUND', 'Task not found');
    return null;
  }

  if (!['todo', 'done'].includes(newStatus)) {
    errors.sendError(res, 400, 'INVALID_STATUS', 'Invalid task status');
    return null;
  }

  tasksStore[taskIndex].status = newStatus;
  return tasksStore[taskIndex];
}

module.exports = {
  getTasks,
  updateTask
};
