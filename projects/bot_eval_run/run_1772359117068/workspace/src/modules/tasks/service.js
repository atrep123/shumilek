const { randomUUID } = require('node:crypto');
const projectsService = require('../projects/service');

function getTasks(projectId, status) {
  const project = projectsService.getAllProjects().find(p => p.id === projectId);
  if (!project || !project.tasks) {
    return [];
  }
  return status ? project.tasks.filter(t => t.status === status) : project.tasks;
}

function createTask(projectId, name) {
  const project = projectsService.getAllProjects().find(p => p.id === projectId);
  if (!project || !project.tasks) {
    project.tasks = [];
  }
  const task = { id: randomUUID(), name, status: 'todo' };
  project.tasks.push(task);
  return task;
}

function updateTask(projectId, taskId, status) {
  const project = projectsService.getAllProjects().find(p => p.id === projectId);
  if (!project || !project.tasks) {
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
  getTasks,
  createTask,
  updateTask,
};
