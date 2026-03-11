const { generateId, createError } = require('../../lib');

let projects = [];

function createProject(data) {
  if (!data.name) return null;
  const project = { id: generateId(), name: data.name, members: [], tasks: [] };
  projects.push(project);
  return project;
}

function getProjects() {
  return projects;
}

function getProjectById(id) {
  return projects.find(p => p.id === id);
}

module.exports = { createProject, getProjects, getProjectById };
