const { generateId } = require('../../lib/id');

let projects = [];

function getAllProjects() {
  return projects;
}

function createProject(name) {
  const project = { id: generateId(), name, tasks: [], members: [] };
  projects.push(project);
  return project;
}

module.exports = {
  getAllProjects,
  createProject,
};
