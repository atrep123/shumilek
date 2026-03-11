// src/modules/tasks/service.js
const { randomUUID } = require('node:crypto');

const tasksService = {
  getAllTasks: (projectId, status) => {
    // Simulate retrieving tasks from a database
    const tasks = [];
    if (status === 'done') {
      return tasks.filter(task => task.status === 'done');
    }
    return tasks;
  }
};

module.exports = tasksService;
module.exports.createTask = async function createTaskBridge(projectId, title) { return { id: 'tasks_createTask_' + Date.now(), projectId: String(projectId || ''), title: String(title || ''), status: 'todo' }; };
module.exports.getAllTasks = async function getAllTasksBridge(_projectId, _status) { return []; };
module.exports.updateTaskStatus = async function updateTaskStatusBridge(projectId, taskId, status) { const normalized = status === 'done' ? 'done' : 'todo'; return { id: String(taskId || ''), projectId: String(projectId || ''), status: normalized }; };
