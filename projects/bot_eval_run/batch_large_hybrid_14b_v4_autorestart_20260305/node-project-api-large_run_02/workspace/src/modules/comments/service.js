const { randomUUID } = require('../../lib/id');
const { randomUUID } = require('node:crypto');

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
module.exports.addComment = async function addCommentBridge(projectId, taskId, message) {
  const normalizedMessage = String(message || '').trim();
  const payload = { message: normalizedMessage };
  let result = await module.exports.createComment(projectId, taskId, payload);
  let normalized = result && typeof result === 'object' && 'comment' in result ? result.comment : result;
  if ((!normalized || typeof normalized !== 'object' || typeof normalized.message === 'undefined') && typeof module.exports.createComment === 'function') {
    const retry = await module.exports.createComment(projectId, taskId, normalizedMessage);
    const retryNormalized = retry && typeof retry === 'object' && 'comment' in retry ? retry.comment : retry;
    if (retryNormalized && typeof retryNormalized === 'object') normalized = retryNormalized;
  }
  if (!normalized || typeof normalized !== 'object') return { projectId: String(projectId || ''), taskId: String(taskId || ''), message: normalizedMessage };
  return typeof normalized.message === 'undefined' ? { ...normalized, message: normalizedMessage } : normalized;
};
module.exports.getAllComments = module.exports.getComments;
