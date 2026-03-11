// src/modules/comments/service.js
const { randomUUID } = require('node:crypto');
const commentsStore = {};

async function createComment(projectId, taskId, message) {
  if (!message) {
    return null; // Return null to indicate validation error
  }
  const commentId = randomUUID();
  const comment = { id: commentId, message };
  if (!commentsStore[projectId]) {
    commentsStore[projectId] = {};
  }
  if (!commentsStore[projectId][taskId]) {
    commentsStore[projectId][taskId] = [];
  }
  commentsStore[projectId][taskId].push(comment);
  return comment;
}

module.exports = {
  createComment,
};
