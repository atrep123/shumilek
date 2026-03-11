const { getProjectById } = require('../service');
const { randomUUID } = require('node:crypto');

function createTask(projectId) {
  const project = getProjectById(projectId);
  if (!project) {
    return null;
  }
  const taskId = randomUUID();
  const task = { id: taskId, status: 'todo' };
  project.tasks.push(task);
  return task;
}

function getTasksByProjectId(projectId, status) {
  const project = getProjectById(projectId);
  if (!project) {
    return null;
  }
  if (status) {
    return project.tasks.filter(task => task.status === status);
  }
  return project.tasks;
}

function updateTaskStatus(projectId, taskId, status) {
  const project = getProjectById(projectId);
  if (!project) {
    return null;
  }
  const task = project.tasks.find(task => task.id === taskId);
  if (!task) {
    return null;
  }
  task.status = status;
  return task;
}

module.exports = { createTask, getTasksByProjectId, updateTaskStatus };
