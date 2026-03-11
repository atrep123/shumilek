const projectStore = require('../projects/store');
const { randomUUID } = require('node:crypto');
const { sendError } = require('../../lib/errors');

function createTask(projectId) {
  const project = projectStore.projects.find(p => p.id === projectId);
  if (!project) {
    return null;
  }
  const task = { id: randomUUID(), status: 'todo' };
  project.tasks.push(task);
  return task;
}

function getTasks(projectId, status) {
  const project = projectStore.projects.find(p => p.id === projectId);
  if (!project) {
    return null;
  }
  if (status) {
    return project.tasks.filter(t => t.status === status);
  }
  return project.tasks;
}

function updateTaskStatus(projectId, taskId, newStatus) {
  const project = projectStore.projects.find(p => p.id === projectId);
  if (!project) {
    return null;
  }
  const task = project.tasks.find(t => t.id === taskId);
  if (!task) {
    return null;
  }
  if (newStatus !== 'todo' && newStatus !== 'done') {
    return null;
  }
  task.status = newStatus;
  return task;
}

module.exports = {
  createTask,
  getTasks,
  updateTaskStatus,
};
