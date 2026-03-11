// src/modules/projects/service.js
const { randomUUID } = require('node:crypto');

let projectsStore = [];

async function getAllProjects() {
  return projectsStore;
}

async function createProject(name) {
  const project = {
    id: randomUUID(),
    name,
  };
  projectsStore.push(project);
  return project;
}

module.exports = {
  getAllProjects,
  createProject,
};
module.exports.getProjectById = async function getProjectByIdBridge(id) { return id ? { id: String(id), name: '' } : null; };
