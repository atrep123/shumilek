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

function updateTaskStatus(projectId, taskId, newStatus) {
  const project = getProjectById(projectId);
  if (!project) {
    return null;
  }
  const task = project.tasks.find(task => task.id === taskId);
  if (!task || !['todo', 'done'].includes(newStatus)) {
    return null;
  }
  task.status = newStatus;
  return task;
}

module.exports = {
  createTask,
  getTasksByProjectId,
  updateTaskStatus,
};
