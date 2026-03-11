const { randomUUID } = require('../../lib/id');

let commentsStore = [];

const createComment = async (taskId, message) => {
  const commentId = randomUUID();
  const comment = { id: commentId, taskId, message };
  commentsStore.push(comment);
  return comment;
};

const getComments = async (taskId) => {
  return commentsStore.filter(comment => comment.taskId === taskId);
};

module.exports = { createComment, getComments };
