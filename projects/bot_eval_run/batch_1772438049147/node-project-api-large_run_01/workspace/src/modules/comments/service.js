// src/modules/comments/service.js
const { randomUUID } = require('node:crypto');
const projectsStore = require('../projects/service').projectsStore;

async function addComment(projectId, taskId, message) {
  const project = projectsStore.find(p => p.id === projectId);
  if (!project) {
    throw { code: 'PROJECT_NOT_FOUND' };
  }
  const task = project.tasks.find(t => t.id === taskId);
  if (!task) {
    throw { code: 'TASK_NOT_FOUND' };
  }
  const newComment = { id: randomUUID(), projectId, taskId, message };
  task.comments = task.comments || [];
  task.comments.push(newComment);
  return newComment;
}

module.exports = {
  addComment,
};
