// src/modules/projects/service.js
const { randomUUID } = require('node:crypto');
const { sendError } = require('../../lib/errors');

let projectsStore = [];

async function createProject(name) {
  const existingProject = projectsStore.find(project => project.name === name);
  if (existingProject) {
    return null;
  }

  const project = { id: randomUUID(), name };
  projectsStore.push(project);
  return project;
}

async function getAllProjects() {
  return projectsStore;
}

module.exports = {
  createProject,
  getAllProjects,
};
