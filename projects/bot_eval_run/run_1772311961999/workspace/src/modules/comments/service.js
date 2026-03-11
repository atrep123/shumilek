const projectsService = require('../projects/service');
const { randomUUID } = require('node:crypto');

function addComment(projectId, taskId, message) {
  const project = projectsService.getProjectById(projectId);
  if (!project) return null;
  const task = project.tasks.find(t => t.id === taskId);
  if (!task) return null;
  const comment = { id: randomUUID(), message };
  if (!task.comments) {
    task.comments = [];
  }
  task.comments.push(comment);
  return comment;
}

function getComments(projectId, taskId) {
  const project = projectsService.getProjectById(projectId);
  if (!project) return null;
  const task = project.tasks.find(t => t.id === taskId);
  if (!task || !task.comments) return [];
  return task.comments;
}

module.exports = {
  addComment,
  getComments
};
