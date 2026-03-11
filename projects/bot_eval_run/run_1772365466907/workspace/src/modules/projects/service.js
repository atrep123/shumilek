const { randomUUID } = require('node:crypto');

let projects = [];

function addProject(name) {
  const project = { id: randomUUID(), name };
  projects.push(project);
  return project;
}

function getAllProjects() {
  return projects;
}

function getProjectById(id) {
  return projects.find(p => p.id === id);
}

module.exports = {
  addProject,
  getAllProjects,
  getProjectById,
};
