const { randomUUID } = require('node:crypto');

let projects = {};

function getAllProjects() {
  return Object.values(projects);
}

function createProject(name) {
  const projectId = randomUUID();
  const project = { id: projectId, name, tasks: [], members: [] };
  projects[projectId] = project;
  return project;
}

module.exports = {
  getAllProjects,
  createProject,
};
