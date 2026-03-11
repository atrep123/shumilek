// src/modules/tasks/service.js
const { randomUUID } = require('node:crypto');
const projectsService = require('../projects/service');
const { sendError } = require('../../lib/errors');

let tasksStore = [];

async function createTask(projectId, title) {
  const project = await projectsService.getAllProjects().find(p => p.id === projectId);
  if (!project) {
    return null;
  }

  const task = { id: randomUUID(), projectId, title, status: 'todo' };
  tasksStore.push(task);
  return task;
}

async function getTasksByStatus(projectId, status) {
  const project = await projectsService.getAllProjects().find(p => p.id === projectId);
  if (!project) {
    return null;
  }

  return tasksStore.filter(task => task.projectId === projectId && (status ? task.status === status : true));
}

async function updateTaskStatus(projectId, taskId, status) {
  const project = await projectsService.getAllProjects().find(p => p.id === projectId);
  if (!project) {
    return null;
  }

  const taskIndex = tasksStore.findIndex(task => task.projectId === projectId && task.id === taskId);
  if (taskIndex === -1) {
    return null;
  }

  tasksStore[taskIndex].status = status;
  return tasksStore[taskIndex];
}

module.exports = {
  createTask,
  getTasksByStatus,
  updateTaskStatus,
};
