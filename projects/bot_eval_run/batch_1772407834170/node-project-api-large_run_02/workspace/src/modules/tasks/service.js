// src/modules/tasks/service.js
const { randomUUID } = require('node:crypto');
const tasksStore = {};

async function getAllTasks(projectId) {
  if (!tasksStore[projectId]) {
    tasksStore[projectId] = [];
  }
  return tasksStore[projectId];
}

async function getCommentsForTask(projectId, taskId) {
  const task = await findTaskById(projectId, taskId);
  if (!task) {
    return null; // Return null to indicate not found error
  }
  return task.comments || [];
}

async function createTask(projectId, title, description) {
  if (!title || !description) {
    return null; // Return null to indicate validation error
  }
  const taskId = randomUUID();
  const task = { id: taskId, title, description, status: 'todo', comments: [] };
  if (!tasksStore[projectId]) {
    tasksStore[projectId] = [];
  }
  tasksStore[projectId].push(task);
  return task;
}

async function updateTaskStatus(projectId, taskId, status) {
  const validStatuses = ['todo', 'done'];
  if (!validStatuses.includes(status)) {
    return null; // Return null to indicate validation error
  }
  const task = await findTaskById(projectId, taskId);
  if (!task) {
    return null; // Return null to indicate not found error
  }
  task.status = status;
  return task;
}

async function findTaskById(projectId, taskId) {
  const tasks = await getAllTasks(projectId);
  return tasks.find(task => task.id === taskId);
}

module.exports = {
  getAllTasks,
  getCommentsForTask,
  createTask,
  updateTaskStatus,
};
