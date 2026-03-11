const { randomUUID } = require('node:crypto');
const projects = require('../projects/service').getAll();
const tasks = require('../tasks/service').getAll;
const comments = {};

function create(projectId, taskId, commentData) {
  const project = projects.find(p => p.id === projectId);
  if (!project) {
    throw { code: 'not_found', message: 'Project not found' };
  }
  const task = tasks(projectId).find(t => t.id === taskId);
  if (!task) {
    throw { code: 'not_found', message: 'Task not found' };
  }
  const commentId = randomUUID();
  if (!comments[taskId]) {
    comments[taskId] = [];
  }
  comments[taskId].push({ ...commentData, id: commentId });
  return comments[taskId][comments[taskId].length - 1];
}

function getAll(projectId, taskId) {
  const project = projects.find(p => p.id === projectId);
  if (!project) {
    throw { code: 'not_found', message: 'Project not found' };
  }
  const taskComments = comments[taskId] || [];
  return taskComments;
}

module.exports = { create, getAll };
