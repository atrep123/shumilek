// src/modules/tasks/service.js
const { randomUUID } = require('node:crypto');

let tasks = [];

module.exports = {
  getAllTasks(projectId) {
    return tasks.filter(task => task.projectId === projectId);
  },

  createTask(projectId, description) {
    if (!description) return null;
    const newTask = { id: randomUUID(), projectId, description, status: 'todo' };
    tasks.push(newTask);
    return newTask;
  },

  updateTaskStatus(taskId, status) {
    if (status !== 'todo' && status !== 'done') return null;
    const task = tasks.find(t => t.id === taskId);
    if (!task) return null;
    task.status = status;
    return task;
  }
};
