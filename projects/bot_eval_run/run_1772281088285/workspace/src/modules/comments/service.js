const { generateId } = require('../../lib/id');
let commentsByTask = {};

function getAllComments(projectId, taskId) {
  const taskKey = `${projectId}-${taskId}`;
  return commentsByTask[taskKey] || [];
}

async function createComment(projectId, taskId, data) {
  const taskKey = `${projectId}-${taskId}`;
  if (!commentsByTask[taskKey]) {
    commentsByTask[taskKey] = [];
  }
  const comment = { id: generateId(), ...data };
  commentsByTask[taskKey].push(comment);
  return comment;
}

module.exports = {
  getAllComments,
  createComment
};
