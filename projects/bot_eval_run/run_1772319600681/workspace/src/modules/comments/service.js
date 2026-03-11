const projectStore = require('../projects/store');
const { randomUUID } = require('node:crypto');
const { sendError } = require('../../lib/errors');

function addComment(projectId, taskId, message) {
  const project = projectStore.projects.find(p => p.id === projectId);
  if (!project) {
    return null;
  }
  const task = project.tasks.find(t => t.id === taskId);
  if (!task) {
    return null;
  }
  const comment = { id: randomUUID(), message };
  if (!task.comments) {
    task.comments = [];
  }
  task.comments.push(comment);
  return comment;
}

function getComments(projectId, taskId) {
  const project = projectStore.projects.find(p => p.id === projectId);
  if (!project) {
    return null;
  }
  const task = project.tasks.find(t => t.id === taskId);
  if (!task || !task.comments) {
    return [];
  }
  return task.comments;
}

module.exports = {
  addComment,
  getComments,
};
