const { randomUUID } = require('../../lib/id');
const { randomUUID } = require('node:crypto');

let tasksStore = [];

const createTask = async (projectId, description) => {
  const taskId = randomUUID();
  const task = { id: taskId, projectId, description, status: 'todo' };
  tasksStore.push(task);
  return task;
};

const getTasks = async (projectId) => {
  return tasksStore.filter(task => task.projectId === projectId);
};

const getDoneTasks = async (projectId) => {
  return tasksStore.filter(task => task.projectId === projectId && task.status === 'done');
};

module.exports = { createTask, getTasks, getDoneTasks };
module.exports.getAllTasks = async function getAllTasksBridge(projectId, status) {
  const result = await module.exports.getTasks(projectId, status);
  const list = Array.isArray(result) ? result : (result && typeof result === 'object' && Array.isArray(result.tasks) ? result.tasks : []);
  const normalized = list.map(item => item && typeof item === 'object' && 'task' in item ? item.task : item).filter(Boolean);
  if (status === 'todo' || status === 'done') return normalized.filter(task => task && task.status === status);
  return normalized;
};
module.exports.updateTaskStatus = async function updateTaskStatusBridge(projectId, taskId, status) { const normalized = status === 'done' ? 'done' : 'todo'; const list = Array.isArray(tasksStore) ? tasksStore : []; const target = list.find(task => task && String(task.id || '') === String(taskId || '') && String(task.projectId || '') === String(projectId || '')); if (!target) return null; target.status = normalized; return target; };
