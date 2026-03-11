const { randomUUID } = require('node:crypto');
const tasksService = require('../tasks/service');
const comments = {};

function addComment(projectId, taskId, { message }) {
  if (!message) throw { code: 'invalid_input', message: 'Message is required' };
  const task = tasksService.updateTask(projectId, taskId, {});
  const id = randomUUID();
  if (!comments[taskId]) comments[taskId] = [];
  const comment = { id, message };
  comments[taskId].push(comment);
  return comment;
}

function getAllComments(projectId, taskId) {
  tasksService.updateTask(projectId, taskId, {});
  return comments[taskId] || [];
}

module.exports = { addComment, getAllComments };
