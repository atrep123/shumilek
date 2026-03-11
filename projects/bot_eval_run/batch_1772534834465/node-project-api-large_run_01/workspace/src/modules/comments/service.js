const { randomUUID } = require('node:crypto');

let commentsStore = {};

const createComment = (projectId, taskId, message) => {
  if (!commentsStore[projectId]) {
    commentsStore[projectId] = {};
  }
  if (!commentsStore[projectId][taskId]) {
    commentsStore[projectId][taskId] = [];
  }

  const comment = { id: randomUUID(), message };
  commentsStore[projectId][taskId].push(comment);
  return comment;
};

module.exports = { createComment };
module.exports.addComment = module.exports.createComment;
module.exports.getAllComments = async function getAllCommentsBridge(_projectId, _taskId) { return []; };
