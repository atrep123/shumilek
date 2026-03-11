const idService = require('../lib/id');
const errors = require('../lib/errors');
const taskService = require('../tasks/service');

let comments = [];

function getCommentsByTaskId(projectId, taskId) {
  taskService.getTasksByProjectId(projectId);
  return comments.filter(c => c.taskId === taskId);
}

function createComment(projectId, taskId, message) {
  taskService.getTasksByProjectId(projectId);
  const comment = { id: idService.generateId(), taskId, message };
  comments.push(comment);
  return comment;
}

module.exports = { getCommentsByTaskId, createComment };
