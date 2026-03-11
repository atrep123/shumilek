const { getProjectById } = require('../service');
const { randomUUID } = require('node:crypto');

function createTask(projectId, title) {
  const project = getProjectById(projectId);
  if (!project) {
    return null;
  }
  const taskId = randomUUID();
  const task = { id: taskId, title, status: 'todo' };
  project.tasks.push(task);
  return task;
}

function getTasksByProjectId(projectId, status) {
  const project = getProjectById(projectId);
  if (!project) {
    return [];
  }
  if (status) {
    return project.tasks.filter(task => task.status === status);
  }
  return project.tasks;
}

module.exports = {
  createTask,
  getTasksByProjectId,
};
