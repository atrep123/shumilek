const { randomUUID } = require('node:crypto');
const projectsStore = require('../projects/store');

function createTask(projectId) {
  const project = projectsStore.projects[projectId];
  if (!project) {
    return null;
  }
  const taskId = randomUUID();
  const task = { id: taskId, status: 'todo' };
  project.tasks.push(task);
  return task;
}

function getTasksByProjectId(projectId) {
  const project = projectsStore.projects[projectId];
  if (!project) {
    return null;
  }
  return project.tasks;
}

function updateTaskStatus(projectId, taskId, status) {
  const project = projectsStore.projects[projectId];
  if (!project) {
    return null;
  }
  const task = project.tasks.find(t => t.id === taskId);
  if (!task) {
    return null;
  }
  task.status = status;
  return task;
}

module.exports = {
  createTask,
  getTasksByProjectId,
  updateTaskStatus,
};
