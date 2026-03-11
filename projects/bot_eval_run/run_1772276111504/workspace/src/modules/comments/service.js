const { generateId, createError } = require('../../lib');
const tasksService = require('../tasks/service');

function addCommentToTask(projectId, taskId, message) {
  const task = tasksService.getTasksByProjectId(projectId).find(t => t.id === taskId);
  if (!task) {
    throw createError('not_found', 'Task not found.');
  }
  const comment = { id: generateId(), message };
  if (!task.comments) {
    task.comments = [];
  }
  task.comments.push(comment);
  return comment;
}

function getCommentsByTaskId(projectId, taskId) {
  const task = tasksService.getTasksByProjectId(projectId).find(t => t.id === taskId);
  if (!task || !task.comments) {
    throw createError('not_found', 'Comments not found.');
  }
  return task.comments;
}

module.exports = { addCommentToTask, getCommentsByTaskId };
