const { randomUUID } = require('node:crypto');
const store = require('./store');

function getAllProjects() {
  return Object.values(store.projects);
}

function getProjectById(projectId) {
  return store.projects[projectId];
}

function createProject(name) {
  const projectId = randomUUID();
  const project = { id: projectId, name, members: [], tasks: [] };
  store.projects[projectId] = project;
  return project;
}

module.exports = {
  getAllProjects,
  getProjectById,
  createProject,
};
