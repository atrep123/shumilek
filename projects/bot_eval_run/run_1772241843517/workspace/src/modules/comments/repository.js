let comments = [];
let currentId = 1;

function getAll(taskId) {
  return comments.filter(c => c.taskId === taskId);
}

function create(taskId, message) {
  const comment = { id: currentId++, taskId, message };
  comments.push(comment);
  return comment;
}

module.exports = { getAll, create };
