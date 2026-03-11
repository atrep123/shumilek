// src/modules/tasks/service.js
const { randomUUID } = require('node:crypto');

let tasksStore = [];

module.exports = {
  getTasksByStatus(status) {
    return tasksStore.filter(task => task.status === status);
  },
  updateTaskStatus(taskId, newStatus) {
    const task = tasksStore.find(task => task.id === taskId);
    if (task) {
      task.status = newStatus;
      return task;
    }
    return null;
  },
  createTask(title) {
    const task = { id: randomUUID(), title, status: 'todo' };
    tasksStore.push(task);
    return task;
  },
  getTasksByProjectId(projectId) {
    // Assuming projectId is used to filter tasks
    return tasksStore.filter(task => task.projectId === projectId);
  }
};
