// src/modules/comments/service.js
const { randomUUID } = require('node:crypto');
const commentsStore = [];

async function addComment(projectId, taskId, message) {
  const comment = {
    id: randomUUID(),
    projectId,
    taskId,
    message,
    createdAt: new Date().toISOString()
  };
  commentsStore.push(comment);
  return comment;
}

module.exports = {
  addComment
};
module.exports.createComment = module.exports.addComment;
