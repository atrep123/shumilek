// src/modules/projects/service.js
const { randomUUID } = require('node:crypto');

const projectsStore = {};

async function getAllProjects() {
  return Object.values(projectsStore);
}

async function createProject(name) {
  const project = { id: randomUUID(), name };
  projectsStore[project.id] = project;
  return project;
}

async function getProjectById(projectId) {
  return projectsStore[projectId];
}

module.exports = { getAllProjects, createProject, getProjectById };
