const { randomUUID } = require('node:crypto');

let comments = [];

const addComment = (projectId, taskId, message) => {
  const comment = { id: randomUUID(), projectId, taskId, message };
  comments.push(comment);
  return comment;
};

module.exports = {
  addComment
};
