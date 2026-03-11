const { randomUUID } = require('node:crypto');
const taskService = require('../tasks/service');

let comments = [];

function addComment(projectId, taskId, message) {
  const tasks = taskService.getTasksByProject(projectId);
  if (!tasks || !tasks.find(t => t.id === taskId)) return null;

  const comment = { id: randomUUID(), projectId, taskId, message };
  comments.push(comment);
  return comment;
}

function getCommentsByTask(projectId, taskId) {
  const tasks = taskService.getTasksByProject(projectId);
  if (!tasks || !tasks.find(t => t.id === taskId)) return null;

  return comments.filter(c => c.projectId === projectId && c.taskId === taskId);
}

module.exports = {
  addComment,
  getCommentsByTask,
};
