const { generateId, createError } = require('../../lib/id'), require('../../lib/errors');
let projects = require('../projects/service').getProjects();

function addCommentToTask(projectId, taskId, data) {
  const project = projects.find(p => p.id === projectId);
  if (!project) return createError(404, 'NOT_FOUND', 'Project not found');
  const task = project.tasks.find(t => t.id === taskId);
  if (!task) return createError(404, 'NOT_FOUND', 'Task not found');
  if (!data.message) return createError(400, 'INVALID_DATA', 'Message is required');
  const comment = { id: generateId(), message: data.message };
  task.comments = task.comments || [];
  task.comments.push(comment);
  return comment;
}

function getCommentsByTaskId(projectId, taskId) {
  const project = projects.find(p => p.id === projectId);
  if (!project) return createError(404, 'NOT_FOUND', 'Project not found');
  const task = project.tasks.find(t => t.id === taskId);
  if (!task) return createError(404, 'NOT_FOUND', 'Task not found');
  return task.comments || [];
}

module.exports = { addCommentToTask, getCommentsByTaskId };
