const { generateId } = require('../../lib/id');
const projectsService = require('../projects/service');

function getAllTasks(projectId) {
  const project = projectsService.getAllProjects().find(p => p.id === projectId);
  if (!project) {
    throw new Error('Project not found');
  }
  return project.tasks;
}

function createTask(projectId, title) {
  const project = projectsService.getAllProjects().find(p => p.id === projectId);
  if (!project) {
    throw new Error('Project not found');
  }
  const task = { id: generateId(), title, status: 'pending', comments: [] };
  project.tasks.push(task);
  return task;
}

module.exports = {
  getAllTasks,
  createTask,
};
