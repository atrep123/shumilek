// src/modules/tasks/service.js
const { randomUUID } = require('node:crypto');

module.exports = {
  createTask(projectId, task) {
    // Implement task creation logic here
    return { id: randomUUID(), projectId, ...task, status: 'todo' };
  },
  updateTask(taskId, updatedTask) {
    // Implement task update logic here
    return { id: taskId, ...updatedTask };
  }
};
module.exports.getAllTasks = async function getAllTasksBridge(_projectId, _status) { return []; };
