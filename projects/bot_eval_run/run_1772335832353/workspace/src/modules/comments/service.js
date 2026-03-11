const { generateId } = require('../../lib/id');
let projectsStore = {};

const createComment = (projectId, taskId, message) => {
  if (!projectsStore[projectId] || !projectsStore[projectId].tasks[taskId]) {
    return null;
  }

  const commentId = generateId();
  const comment = { id: commentId, message };

  projectsStore[projectId].tasks[taskId].comments.push(comment);
  return comment;
};

module.exports = { createComment };
