// src/modules/comments/service.js
const { randomUUID } = require('node:crypto');

const commentsService = {
  createComment: (message) => {
    if (!message) {
      return null;
    }
    const commentId = randomUUID();
    // Simulate storing the comment in a database
    return { id: commentId, message };
  },
  getAllComments: () => {
    // Simulate retrieving comments from a database
    return [];
  }
};

module.exports = commentsService;
module.exports.getAllComments = async function getAllCommentsBridge(_projectId, _taskId) { return []; };
