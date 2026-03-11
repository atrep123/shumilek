const { randomUUID } = require('node:crypto');
const projectsStore = require('../projects/store');

function addComment(projectId, taskId, message) {
  const project = projectsStore.projects[projectId];
  if (!project) {
    return null;
  }
  const task = project.tasks.find(t => t.id === taskId);
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
  addComment,
};
