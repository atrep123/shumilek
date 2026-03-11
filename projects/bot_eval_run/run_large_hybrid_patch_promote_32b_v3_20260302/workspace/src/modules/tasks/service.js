const { getProjectById } = require('../projects/service');
const { randomUUID } = require('node:crypto');

const createTask = (projectId) => {
  const project = getProjectById(projectId);
  if (!project) {
    return null;
  }
  const taskId = randomUUID();
  const task = { id: taskId, status: 'todo' };
  project.tasks.push(task);
  return task;
};

const getTasksByProjectId = (projectId) => {
  const project = getProjectById(projectId);
  if (!project) {
    return null;
  }
  return project.tasks;
};

const updateTaskStatus = (projectId, taskId, status) => {
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
};

module.exports = { createTask, getTasksByProjectId, updateTaskStatus };
