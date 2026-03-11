// src/modules/tasks/service.js
const { randomUUID } = require('node:crypto');

let tasksStore = [];

module.exports = {
  getTasksByStatus(status) {
    return tasksStore.filter(task => task.status === status);
  },
  createTask(projectId, title) {
    if (!projectId || !title) return null;
    const newTask = { id: randomUUID(), projectId, title, status: 'todo' };
    tasksStore.push(newTask);
    return newTask;
  }
};
module.exports.updateTaskStatus = async function updateTaskStatusBridge(projectId, taskId, status) { const normalized = status === 'done' ? 'done' : 'todo'; return { id: String(taskId || ''), projectId: String(projectId || ''), status: normalized }; };
