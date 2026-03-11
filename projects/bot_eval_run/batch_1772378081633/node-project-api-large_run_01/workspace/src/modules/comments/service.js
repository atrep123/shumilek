const { randomUUID } = require('node:crypto');

let commentsStore = [];

async function addComment(projectId, taskId, message) {
  const comment = {
    id: randomUUID(),
    projectId,
    taskId,
    message,
  };
  commentsStore.push(comment);
  return comment;
}

module.exports = {
  addComment,
};
