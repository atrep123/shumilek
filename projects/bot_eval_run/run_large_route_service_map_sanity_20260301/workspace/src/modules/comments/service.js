const comments = {};
const { randomUUID } = require('node:crypto');

exports.createComment = (taskId, { message }) => {
  if (!message) throw new BadRequestError('Message is required');
  const id = randomUUID();
  comments[id] = { id, taskId, message };
  return comments[id];
};

exports.getCommentsByTask = (taskId) => {
  const taskComments = Object.values(comments).filter(comment => comment.taskId === taskId);
  return taskComments.length ? { comments: taskComments } : null;
};
