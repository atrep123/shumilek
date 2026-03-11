const { randomUUID } = require('node:crypto');
const commentsByTaskId = {};

async function addComment(projectId, taskId, data) {
  if (!commentsByTaskId[taskId]) {
    commentsByTaskId[taskId] = [];
  }
  const comment = {
    id: randomUUID(),
    text: data.text,
  };
  commentsByTaskId[taskId].push(comment);
  return comment;
}

async function listComments(projectId, taskId) {
  return commentsByTaskId[taskId] || [];
}

module.exports = {
  addComment,
  listComments,
};