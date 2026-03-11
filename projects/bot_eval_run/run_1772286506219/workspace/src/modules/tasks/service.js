const { generateId, createError } = require('../../lib/id'), require('../../lib/errors');
let projects = require('../projects/service').getProjects();

function createTask(projectId, data) {
  const project = projects.find(p => p.id === projectId);
  if (!project) return createError(404, 'NOT_FOUND', 'Project not found');
  if (!data.title) return createError(400, 'INVALID_DATA', 'Title is required');
  const task = { id: generateId(), title: data.title, status: 'pending' };
  project.tasks.push(task);
  return task;
}

function getTasksByProjectId(projectId, status) {
  const project = projects.find(p => p.id === projectId);
  if (!project) return createError(404, 'NOT_FOUND', 'Project not found');
  let tasks = project.tasks;
  if (status) {
    tasks = tasks.filter(t => t.status === status);
  }
  return tasks;
}

function updateTaskStatus(projectId, taskId, data) {
  const project = projects.find(p => p.id === projectId);
  if (!project) return createError(404, 'NOT_FOUND', 'Project not found');
  const task = project.tasks.find(t => t.id === taskId);
  if (!task) return createError(404, 'NOT_FOUND', 'Task not found');
  if (!['pending', 'done'].includes(data.status)) return createError(400, 'INVALID_DATA', 'Invalid status');
  task.status = data.status;
  return task;
}

module.exports = { createTask, getTasksByProjectId, updateTaskStatus };
