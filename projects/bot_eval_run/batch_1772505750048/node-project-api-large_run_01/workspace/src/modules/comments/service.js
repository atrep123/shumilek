const tasksService = require('../tasks/service');
const { randomUUID } = require('node:crypto');

function createComment(projectId, taskId, message) {
  const task = tasksService.getTasksByProjectId(projectId)?.find(task => task.id === taskId);
  if (!task) {
    return null;
  }
  const comment = { id: randomUUID(), message };
  if (!task.comments) {
    task.comments = [];
  }
  task.comments.push(comment);
  return comment;
}

function getCommentsByTaskId(projectId, taskId) {
  const task = tasksService.getTasksByProjectId(projectId)?.find(task => task.id === taskId);
  if (!task || !task.comments) {
    return null;
  }
  return task.comments;
}

module.exports = {
  createComment,
  getCommentsByTaskId,
};
