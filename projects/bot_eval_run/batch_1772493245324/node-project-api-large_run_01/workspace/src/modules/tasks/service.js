// src/modules/tasks/service.js
const { randomUUID } = require('node:crypto');

let tasksStore = [];

const createTask = (description) => {
  const task = { id: randomUUID(), description, status: 'todo' };
  tasksStore.push(task);
  return task;
};

const getTasks = (status) => {
  if (!status) {
    return tasksStore;
  }
  return tasksStore.filter(task => task.status === status);
};

const updateTask = (taskId, newStatus) => {
  const task = tasksStore.find(t => t.id === taskId);
  if (!task) {
    throw { code: 'NOT_FOUND' };
  }
  task.status = newStatus;
  return task;
};

module.exports = { createTask, getTasks, updateTask };