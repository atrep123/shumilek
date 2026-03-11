const { generateId } = require('../../lib/id');
let commentsStore = {};

const createComment = (projectId, taskId, message) => {
  if (!commentsStore[projectId]) {
    commentsStore[projectId] = {};
  }
  if (!commentsStore[projectId][taskId]) {
    commentsStore[projectId][taskId] = [];
  }

  const commentId = generateId();
  const comment = { id: commentId, message };
  commentsStore[projectId][taskId].push(comment);

  return comment;
};

const getComments = (projectId, taskId) => {
  if (!commentsStore[projectId] || !commentsStore[projectId][taskId]) {
    return [];
  }

  return commentsStore[projectId][taskId];
};

module.exports = { createComment, getComments };
