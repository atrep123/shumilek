const { randomUUID } = require('node:crypto');

let projects = [];

function getAllProjects() {
  return projects;
}

function createProject(name) {
  const project = { id: randomUUID(), name };
  projects.push(project);
  return project;
}

module.exports = {
  getAllProjects,
  createProject,
};
