// src/modules/comments/service.js
const { randomUUID } = require('node:crypto');
const commentsStore = [];

async function addComment(projectId, taskId, message) {
  const comment = { id: randomUUID(), projectId, taskId, message };
  commentsStore.push(comment);
  return comment;
}

module.exports = {
  addComment,
};
