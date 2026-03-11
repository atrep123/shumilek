// src/modules/projects/service.js
const { randomUUID } = require('node:crypto');

let projectsStore = [];

const getProjectById = (projectId) => {
  return projectsStore.find(p => p.id === projectId);
};

const createProject = (name) => {
  const project = { id: randomUUID(), name };
  projectsStore.push(project);
  return project;
};

module.exports = { getProjectById, createProject };
const __botEvalProjectsDupGuard = module.exports.createProject;
module.exports.createProject = async function createProject(name) {
  const normalized = String(name || '').trim();
  let existing = null;
  if (typeof module.exports.getProjectByName === 'function') {
    existing = await module.exports.getProjectByName(normalized);
  } else if (Array.isArray(projectsStore)) {
    existing = projectsStore.find(project => project && String(project.name || '') === normalized);

  }
  if (existing) return null;
  if (typeof __botEvalProjectsDupGuard === 'function') return __botEvalProjectsDupGuard(normalized);
  return null;
};
