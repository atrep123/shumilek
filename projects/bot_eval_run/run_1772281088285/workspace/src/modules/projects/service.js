const { generateId } = require('../../lib/id');
let projects = [];

function getAllProjects() {
  return projects;
}

async function createProject(data) {
  const project = { id: generateId(), ...data };
  projects.push(project);
  return project;
}

function getProjectById(id) {
  return projects.find(p => p.id === id);
}

module.exports = {
  getAllProjects,
  createProject,
  getProjectById
};
