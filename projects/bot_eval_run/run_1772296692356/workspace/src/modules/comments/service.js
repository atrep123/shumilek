const { generateId } = require('../../lib/id');

const projects = {};

function createComment(projectId, taskId, message) {
  if (!projects[projectId] || !projects[projectId].tasks[taskId]) {
    throw new Error('Task not found');
  }

  const commentId = generateId();
  const comment = { id: commentId, message };

  projects[projectId].tasks[taskId].comments.push(comment);
  return comment;
}

function getComments(projectId, taskId) {
  if (!projects[projectId] || !projects[projectId].tasks[taskId]) {
    throw new Error('Task not found');
  }

  return projects[projectId].tasks[taskId].comments;
}

module.exports = { createComment, getComments };
