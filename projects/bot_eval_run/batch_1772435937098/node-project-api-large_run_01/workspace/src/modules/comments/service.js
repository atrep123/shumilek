const { generateId } = require('../../lib/id');

let commentsStore = [];

async function getAllComments(projectId, taskId) {
  return commentsStore.filter(comment => comment.projectId === projectId && comment.taskId === taskId);
}

async function addComment(projectId, taskId, content) {
  if (!commentsStore.some(comment => comment.projectId === projectId)) {
    return null;
  }
  if (!commentsStore.some(comment => comment.taskId === taskId)) {
    return null;
  }
  const comment = { id: generateId(), projectId, taskId, content };
  commentsStore.push(comment);
  return comment;
}

module.exports = { getAllComments, addComment };
