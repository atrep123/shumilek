const { randomUUID } = require('node:crypto');

let projects = [];

function getAllProjects() {
  return projects;
}

function getProjectById(projectId) {
  return projects.find(p => p.id === projectId);
}

function createProject(name) {
  const project = { id: randomUUID(), name, members: [], tasks: [] };
  projects.push(project);
  return project;
}

module.exports = {
  getAllProjects,
  getProjectById,
  createProject
};
