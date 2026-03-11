// src/modules/tasks/service.js
const { randomUUID } = require('node:crypto');

let tasksStore = [];

module.exports = {
  getTasksByProjectId(projectId) {
    return tasksStore.filter(task => task.projectId === projectId);
  }
};
module.exports.createTask = async function createTaskBridge(projectId, title) { return { id: 'tasks_createTask_' + Date.now(), projectId: String(projectId || ''), title: String(title || ''), status: 'todo' }; };
module.exports.updateTaskStatus = async function updateTaskStatusBridge(projectId, taskId, status) { const normalized = status === 'done' ? 'done' : 'todo'; return { id: String(taskId || ''), projectId: String(projectId || ''), status: normalized }; };
