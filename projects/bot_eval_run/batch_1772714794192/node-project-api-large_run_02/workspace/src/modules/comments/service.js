const { randomUUID } = require('node:crypto');
const comments = [];

const addComment = (projectId, taskId, message) => {
  const commentId = randomUUID();
  comments.push({ id: commentId, projectId, taskId, message });
  return { id: commentId, message };
};

const getComments = (projectId, taskId) => {
  return comments.filter(comment => comment.projectId === projectId && comment.taskId === taskId);
};

module.exports = { addComment, getComments };
