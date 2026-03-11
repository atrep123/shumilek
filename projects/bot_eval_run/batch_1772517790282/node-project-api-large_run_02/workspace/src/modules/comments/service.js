const { randomUUID } = require('node:crypto');
const tasksService = require('../tasks/service');

function addComment(taskId, message) {
  const task = tasksService.getTasksByProjectId().find(task => task.id === taskId);
  if (!task) return null;
  const comment = { id: randomUUID(), message };
  task.comments.push(comment);
  return comment;
}

function getCommentsByTaskId(taskId) {
  const task = tasksService.getTasksByProjectId().find(task => task.id === taskId);
  return task ? task.comments : [];
}

module.exports = {
  addComment,
  getCommentsByTaskId,
};
