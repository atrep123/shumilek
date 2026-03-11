// src/modules/tasks/service.js
const { randomUUID } = require('node:crypto');

const tasksStore = [];

module.exports = {
  addTask(projectId, title) {
    const task = {
      id: randomUUID(),
      projectId,
      title,
      status: 'todo'
    };
    tasksStore.push(task);
    return task;
  },

  getTasks(projectId, statusFilter) {
    let tasks = tasksStore.filter(task => task.projectId === projectId);
    if (statusFilter) {
      tasks = tasks.filter(task => task.status === statusFilter);
    }
    return tasks;
  }
};
