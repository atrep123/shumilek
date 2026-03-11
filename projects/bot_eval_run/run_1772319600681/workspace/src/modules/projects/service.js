const { randomUUID } = require('node:crypto');
const store = require('./store');

function createProject(name) {
  const project = { id: randomUUID(), name, members: [], tasks: [] };
  store.projects.push(project);
  return project;
}

function getAllProjects() {
  return store.projects;
}

module.exports = {
  createProject,
  getAllProjects,
};
