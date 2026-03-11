const { getProjectById } = require('../../../projects/service');
const { randomUUID } = require('node:crypto');

function addCommentToTask(projectId, taskId, message) {
  const project = getProjectById(projectId);
  if (!project) {
    return null;
  }
  const task = project.tasks.find(task => task.id === taskId);
  if (!task) {
    return null;
  }
  const commentId = randomUUID();
  const comment = { id: commentId, message };
  if (!task.comments) {
    task.comments = [];
  }
  task.comments.push(comment);
  return comment;
}

module.exports = {
  addCommentToTask,
};
