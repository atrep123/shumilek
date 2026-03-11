// src/modules/tasks/service.js
const { randomUUID } = require('node:crypto');
tasksStore = [];

async function getTasksByProjectId(projectId, status) {
  const tasks = tasksStore.filter(t => t.projectId === projectId);
  if (status) {
    return tasks.filter(t => t.status === status);
  }
  return tasks;
}

async function createTask(projectId, title, description) {
  const project = await getProjectById(projectId);
  if (!project) {
    throw { code: 'PROJECT_NOT_FOUND', message: 'Project not found' };
  }
  const task = { id: randomUUID(), projectId, title, description, status: 'todo' };
  tasksStore.push(task);
  return task;
}

async function updateTaskStatus(projectId, taskId, status) {
  const project = await getProjectById(projectId);
  if (!project) {
    throw { code: 'PROJECT_NOT_FOUND', message: 'Project not found' };
  }
  const taskIndex = tasksStore.findIndex(t => t.id === taskId && t.projectId === projectId);
  if (taskIndex === -1) {
    return null; // Task not found
  }
  tasksStore[taskIndex].status = status;
  return tasksStore[taskIndex];
}

async function getProjectById(projectId) {
  // Placeholder for actual project retrieval logic
  return true; // Assuming project exists for simplicity
}

module.exports = {
  getTasksByProjectId,
  createTask,
  updateTaskStatus,
};