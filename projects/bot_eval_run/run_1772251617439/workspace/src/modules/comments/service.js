const crypto = require('crypto');
const commentsRepo = {};

function getCommentsByTaskId(taskId) {
  return Object.values(commentsRepo).filter(comment => comment.taskId === taskId);
}

function addComment(projectId, taskId, message) {
  if (!message) throw { status: 400, code: 'INVALID_INPUT', message: 'Message is required' };
  const id = crypto.randomUUID();
  commentsRepo[id] = { id, projectId, taskId, message };
  return commentsRepo[id];
}

module.exports = {
  getCommentsByTaskId,
  addComment
};
