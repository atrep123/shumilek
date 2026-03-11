const { randomUUID } = require('node:crypto');
const comments = [];

const addComment = (projectId, taskId, message) => {
  const comment = { id: randomUUID(), projectId, taskId, message };
  comments.push(comment);
  return comment;
};

const getComments = (projectId, taskId) => {
  return comments.filter(comment => comment.projectId === projectId && comment.taskId === taskId);
};

module.exports = { addComment, getComments };
