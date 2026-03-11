// src/modules/projects/service.js
const { randomUUID } = require('node:crypto');
const projectsStore = [];

async function getAllProjects() {
  return projectsStore.slice();
}

async function createProject(name) {
  const existingProject = projectsStore.find(project => project.name === name);
  if (existingProject) {
    throw { code: 'DUPLICATE_PROJECT' };
  }
  const newProject = { id: randomUUID(), name, members: [], tasks: [] };
  projectsStore.push(newProject);
  return newProject;
}

module.exports = {
  getAllProjects,
  createProject,
};
