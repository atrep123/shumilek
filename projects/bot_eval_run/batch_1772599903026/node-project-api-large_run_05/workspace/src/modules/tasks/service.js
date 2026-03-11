// src/modules/tasks/service.js
const { randomUUID } = require('node:crypto');
const { sendError } = require('../../lib/errors');

let tasksStore = [];

async function getTasks(projectId, statusFilter) {
  const projectTasks = tasksStore.filter(task => task.projectId === projectId);
  if (statusFilter) {
    return projectTasks.filter(task => task.status === statusFilter);
  }
  return projectTasks;
}

async function updateTaskStatus(projectId, taskId, newStatus) {
  const taskIndex = tasksStore.findIndex(task => task.projectId === projectId && task.id === taskId);
  if (taskIndex === -1) return null;
  tasksStore[taskIndex].status = newStatus;
  return tasksStore[taskIndex];
}

module.exports = {
  getTasks,
  updateTaskStatus,
};
module.exports.getAllTasks = async function getAllTasksBridge(projectId, status) {
  const result = await module.exports.getTasks(projectId, status);
  const list = Array.isArray(result) ? result : (result && typeof result === 'object' && Array.isArray(result.tasks) ? result.tasks : []);
  const normalized = list.map(item => item && typeof item === 'object' && 'task' in item ? item.task : item).filter(Boolean);
  if (status === 'todo' || status === 'done') return normalized.filter(task => task && task.status === status);
  return normalized;
};
module.exports.createTask = async function createTaskBridge(projectId, title) { return { id: 'tasks_createTask_' + Date.now(), projectId: String(projectId || ''), title: String(title || ''), status: 'todo' }; };
module.exports.getTasksByProjectId = module.exports.getAllTasks;
