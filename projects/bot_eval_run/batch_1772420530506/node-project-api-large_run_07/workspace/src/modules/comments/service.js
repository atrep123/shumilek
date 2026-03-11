const { randomUUID } = require('node:crypto');

let commentsStore = [];

const addComment = (projectId, taskId, message) => {
  const comment = { id: randomUUID(), projectId, taskId, message };
  commentsStore.push(comment);
  return Promise.resolve(comment);
};

const getCommentsByTaskId = (projectId, taskId) => {
  return Promise.resolve(commentsStore.filter(c => c.projectId === projectId && c.taskId === taskId));
};

module.exports = {
  addComment,
  getCommentsByTaskId
};
