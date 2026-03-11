// src/modules/comments/service.js
const { randomUUID } = require('node:crypto');

let commentsStore = [];

module.exports = {
  addComment(taskId, message) {
    if (!message || typeof message !== 'string' || message.trim() === '') {
      return null;
    }
    const newComment = {
      id: randomUUID(),
      taskId,
      message: message.trim()
    };
    commentsStore.push(newComment);
    return newComment;
  },

  getAllComments(taskId) {
    return commentsStore.filter(comment => comment.taskId === taskId);
  }
};
