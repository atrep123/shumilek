const { generateId, createError } = require('../../lib');

const projects = [];

function createProject(name) {
  if (projects.some(p => p.name === name)) {
    throw createError('duplicate', 'Project with this name already exists.');
  }
  const project = { id: generateId(), name, members: [], tasks: [] };
  projects.push(project);
  return project;
}

function getProjects() {
  return projects;
}

function getProjectById(id) {
  const project = projects.find(p => p.id === id);
  if (!project) {
    throw createError('not_found', 'Project not found.');
  }
  return project;
}

module.exports = { createProject, getProjects, getProjectById };
