const { randomUUID } = require('../../lib/id');

let commentsStore = {};

const createComment = async (taskId, message) => {
  const commentId = randomUUID();
  if (!commentsStore[taskId]) {
    commentsStore[taskId] = [];
  }
  commentsStore[taskId].push({ id: commentId, message });
  return { id: commentId, message };
};

const getComments = async (taskId) => {
  if (!commentsStore[taskId]) {
    return [];
  }
  return commentsStore[taskId];
};

module.exports = { createComment, getComments };
