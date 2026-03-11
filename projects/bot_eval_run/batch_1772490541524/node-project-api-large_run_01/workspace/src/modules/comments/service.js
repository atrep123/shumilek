const { randomUUID } = require('../../lib/id');

let commentsStore = [];

const createComment = async (taskId, message) => {
  const commentId = randomUUID();
  const comment = { id: commentId, taskId, message };
  commentsStore.push(comment);
  return comment;
};

module.exports = { createComment };