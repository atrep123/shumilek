const { randomUUID } = require('../../lib/id');

let commentsStore = [];

const addComment = (projectId, taskId, message) => {
  const comment = { id: randomUUID(), projectId, taskId, message };
  commentsStore.push(comment);
  return Promise.resolve(comment);
};

module.exports = { addComment };
