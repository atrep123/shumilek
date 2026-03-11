// src/modules/tasks/service.js
const { randomUUID } = require('node:crypto');
const { sendError } = require('../../lib/errors');

let tasksStore = [];

async function createTask(description) {
  if (!description) {
    return null;
  }
  const task = { id: randomUUID(), description, status: 'todo' };
  tasksStore.push(task);
  return task;
}

async function getTasks(status) {
  if (status === 'done') {
    return tasksStore.filter(t => t.status === 'done');
  }
  return tasksStore;
}

async function updateTask(taskId, status) {
  const task = tasksStore.find(t => t.id === taskId);
  if (!task) {
    throw { code: 'NOT_FOUND', message: 'Task not found' };
  }
  task.status = status;
  return task;
}

module.exports = { createTask, getTasks, updateTask };
