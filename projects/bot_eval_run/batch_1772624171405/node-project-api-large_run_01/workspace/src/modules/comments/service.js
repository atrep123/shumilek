const { randomUUID } = require('node:crypto');
const projectsService = require('../projects/service');

let commentsStore = {};

function getComments(taskId) {
  return commentsStore[taskId] || [];
}

function addComment(taskId, message) {
  const project = projectsService.getProjectByTaskId(taskId);
  if (!project) return null;

  if (!commentsStore[taskId]) {
    commentsStore[taskId] = [];
  }

  const comment = { id: randomUUID(), message };
  commentsStore[taskId].push(comment);
  return comment;
}

module.exports = {
  getComments,
  addComment,
};
