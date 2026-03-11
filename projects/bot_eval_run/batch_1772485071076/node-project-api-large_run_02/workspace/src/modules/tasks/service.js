// src/modules/tasks/service.js
const projectsService = require('../projects/service');
const { randomUUID } = require('node:crypto');

const createTask = async (projectId, title) => {
  const project = await projectsService.getProject(projectId);
  if (!project) {
    return null;
  }
  const task = { id: randomUUID(), projectId, title, status: 'todo' };
  project.tasks.push(task);
  return task;
};

const updateTaskStatus = async (projectId, taskId, status) => {
  const project = await projectsService.getProject(projectId);
  if (!project) {
    return null;
  }
  const task = project.tasks.find(t => t.id === taskId);
  if (!task) {
    return null;
  }
  task.status = status;
  return task;
};

const getTasks = async (projectId, status) => {
  const project = await projectsService.getProject(projectId);
  if (!project) {
    return [];
  }
  if (status) {
    return project.tasks.filter(t => t.status === status);
  }
  return project.tasks;
};

module.exports = { createTask, updateTaskStatus, getTasks };
module.exports.getAllTasks = module.exports.getTasks;
