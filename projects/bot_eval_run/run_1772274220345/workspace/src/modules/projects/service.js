const idService = require('../lib/id');
const errors = require('../lib/errors');

let projects = [];

function getAllProjects() {
  return projects;
}

function createProject(name) {
  if (projects.some(p => p.name === name)) {
    throw new errors.AppError('duplicate', 'Project with this name already exists.');
  }
  const project = { id: idService.generateId(), name };
  projects.push(project);
  return project;
}

function getProjectById(id) {
  const project = projects.find(p => p.id === id);
  if (!project) {
    throw new errors.AppError('not_found', 'Project not found.');
  }
  return project;
}

module.exports = { getAllProjects, createProject, getProjectById };
