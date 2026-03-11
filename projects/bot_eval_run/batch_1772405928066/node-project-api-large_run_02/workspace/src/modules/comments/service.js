// src/modules/comments/service.js
const { randomUUID } = require('node:crypto');

let comments = [];

module.exports = {
  addComment(taskId, message) {
    if (!message) return null;
    const newComment = { id: randomUUID(), taskId, message };
    comments.push(newComment);
    return newComment;
  },

  getAllComments(taskId) {
    return comments.filter(comment => comment.taskId === taskId);
  }
};
