// src/modules/comments/service.js
const { randomUUID } = require('node:crypto');
const commentsStore = [];

async function addComment(projectId, taskId, content) {
  const comment = { id: randomUUID(), projectId, taskId, content };
  commentsStore.push(comment);
  return comment;
}

module.exports = {
  addComment,
};
