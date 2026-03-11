const { generateId, createError } = require('../../lib');
const projectsService = require('../projects/service');

function createTask(projectId, title) {
  const project = projectsService.getProjectById(projectId);
  const task = { id: generateId(), title, status: 'pending' };
  project.tasks.push(task);
  return task;
}

function getTasksByProjectId(projectId) {
  const project = projectsService.getProjectById(projectId);
  return project.tasks;
}

function updateTaskStatus(projectId, taskId, status) {
  const project = projectsService.getProjectById(projectId);
  const task = project.tasks.find(t => t.id === taskId);
  if (!task) {
    throw createError('not_found', 'Task not found.');
  }
  task.status = status;
  return task;
}

module.exports = { createTask, getTasksByProjectId, updateTaskStatus };
