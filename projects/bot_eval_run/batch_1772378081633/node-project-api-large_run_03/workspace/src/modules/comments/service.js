const { randomUUID } = require('../../lib/id');

let commentsStore = [];

const createComment = (taskId, message) => {
  const commentId = randomUUID();
  const comment = { id: commentId, taskId, message };
  commentsStore.push(comment);
  return Promise.resolve(comment);
};

const getComments = (taskId) => {
  const comments = commentsStore.filter(comment => comment.taskId === taskId);
  return Promise.resolve(comments);
};

module.exports = { createComment, getComments };
