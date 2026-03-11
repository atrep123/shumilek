let comments = [];
let currentId = 1;

function getAll(projectId, taskId) {
  return comments.filter(c => c.projectId === projectId && c.taskId === taskId);
}

function create(projectId, taskId, message) {
  const comment = { id: currentId++, projectId, taskId, message };
  comments.push(comment);
  return comment;
}

module.exports = { getAll, create };
