// src/modules/comments/service.js
const { randomUUID } = require('node:crypto');

let commentsStore = [];

module.exports = {
  addComment(projectId, taskId, comment) {
    const newComment = {
      id: randomUUID(),
      projectId,
      taskId,
      message: typeof comment === 'string' ? comment : String(comment?.message || ''),
    };
    commentsStore.push(newComment);
    return newComment;
  },

  getAllComments(projectId, taskId) {
    return commentsStore.filter(comment => comment.projectId === projectId && comment.taskId === taskId);
  }
};
