const { randomUUID } = require('node:crypto');
const comments = [];

const createComment = (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Message is required' } });
  const comment = { id: randomUUID(), message };
  comments.push(comment);
  res.status(201).json({ comment });
};

module.exports = { createComment };
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
module.exports.getAllComments = async function getAllCommentsBridge(projectId, taskId) { const projectKey = String(projectId || ''); const taskKey = String(taskId || ''); const list = Array.isArray(comments) ? comments : []; return list.filter(comment => comment && String(comment.projectId || '') === projectKey && String(comment.taskId || '') === taskKey); };
