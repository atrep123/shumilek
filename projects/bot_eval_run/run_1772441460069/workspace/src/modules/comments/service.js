const { v4: uuidv4 } = require('uuid');
const projects = {};
const comments = {};
export function createComment(projectId, taskId, commentData) {
  if (!commentData.message) throw new BadRequestError('Message is required');
  const commentId = uuidv4();
  if (!projects[projectId] || !projects[projectId].tasks?.[taskId]) return null;
  comments[commentId] = { id: commentId, ...commentData };
  projects[projectId].tasks[taskId].comments = projects[projectId].tasks[taskId].comments || {};
  projects[projectId].tasks[taskId].comments[commentId] = comments[commentId];
  return comments[commentId];
}
