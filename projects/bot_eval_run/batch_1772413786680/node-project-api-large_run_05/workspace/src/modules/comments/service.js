// src/modules/comments/service.js
const { randomUUID } = require('node:crypto');

const commentsService = {
  createComment(projectId, taskId, message) {
    if (!message) {
      return null;
    }
    const comment = {
      id: randomUUID(),
      projectId,
      taskId,
      message,
    };
    // Simulate storing the comment in a database
    comments.push(comment);
    return comment;
  },
};

module.exports = commentsService;
