// src/modules/projects/service.js
const { randomUUID } = require('node:crypto');
const projectsStore = [];

async function getAllProjects() {
  return projectsStore.slice();
}

async function getProjectById(projectId) {
  return projectsStore.find(p => p.id === projectId);
}

async function createProject(name) {
  const newProject = { id: randomUUID(), name };
  projectsStore.push(newProject);
  return newProject;
}

module.exports = {
  getAllProjects,
  getProjectById,
  createProject,
};
