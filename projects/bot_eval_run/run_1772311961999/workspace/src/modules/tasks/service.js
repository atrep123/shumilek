const projectsService = require('../projects/service');
const { randomUUID } = require('node:crypto');

function createTask(projectId) {
  const project = projectsService.getProjectById(projectId);
  if (!project) return null;
  const task = { id: randomUUID(), status: 'todo' };
  project.tasks.push(task);
  return task;
}

function getTasks(projectId, status) {
  const project = projectsService.getProjectById(projectId);
  if (!project) return null;
  if (status) {
    return project.tasks.filter(t => t.status === status);
  }
  return project.tasks;
}

function updateTask(projectId, taskId, status) {
  const project = projectsService.getProjectById(projectId);
  if (!project) return null;
  const task = project.tasks.find(t => t.id === taskId);
  if (!task) return null;
  task.status = status;
  return task;
}

module.exports = {
  createTask,
  getTasks,
  updateTask
};
