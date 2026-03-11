// src/modules/tasks/service.js
const { randomUUID } = require('node:crypto');
const projectsService = require('../projects/service');

let tasksStore = [];

async function getTasksByStatus(projectId, status) {
  const project = await projectsService.getProjectById(projectId);
  if (!project) return null;
  return tasksStore.filter(task => task.projectId === projectId && task.status === status);
}

async function createTask(projectId, message) {
  const project = await projectsService.getProjectById(projectId);
  if (!project) return null;
  const newTask = {
    id: randomUUID(),
    projectId,
    message,
    status: 'todo'
  };
  tasksStore.push(newTask);
  return newTask;
}

async function updateTaskStatus(taskId, newStatus) {
  if (newStatus !== 'todo' && newStatus !== 'done') return null;
  const task = tasksStore.find(t => t.id === taskId);
  if (!task) return null;
  task.status = newStatus;
  return task;
}

module.exports = {
  getTasksByStatus,
  createTask,
  updateTaskStatus
};
