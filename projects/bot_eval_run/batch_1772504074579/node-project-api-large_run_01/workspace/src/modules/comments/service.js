// src/modules/comments/service.js
const { randomUUID } = require('node:crypto');

let commentsStore = [];

async function createComment(message) {
  const commentId = randomUUID();
  const newComment = { id: commentId, message };
  commentsStore.push(newComment);
  return newComment;
}

module.exports = {
  createComment,
};
module.exports.addComment = module.exports.createComment;
