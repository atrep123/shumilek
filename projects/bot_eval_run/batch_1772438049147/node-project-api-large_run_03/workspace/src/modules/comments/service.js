// src/modules/comments/service.js
const { randomUUID } = require('node:crypto');

let commentsStore = [];

async function createComment(projectId, taskId, message) {
  const comment = {
    id: randomUUID(),
    projectId,
    taskId,
    message,
  };
  commentsStore.push(comment);
  return comment;
}

module.exports = {
  createComment,
};