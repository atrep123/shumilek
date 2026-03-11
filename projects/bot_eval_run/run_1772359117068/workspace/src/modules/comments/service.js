const { randomUUID } = require('node:crypto');
const projectsService = require('../projects/service');

function addComment(projectId, taskId, message) {
  const project = projectsService.getAllProjects().find(p => p.id === projectId);
  if (!project || !project.tasks) {
    return null;
  }
  const task = project.tasks.find(t => t.id === taskId);
  if (!task || !task.comments) {
    task.comments = [];
  }
  const comment = { id: randomUUID(), message };
  task.comments.push(comment);
  return comment;
}

module.exports = {
  addComment,
};
