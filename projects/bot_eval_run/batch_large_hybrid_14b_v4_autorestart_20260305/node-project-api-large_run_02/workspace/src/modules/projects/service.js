const { randomUUID } = require('../../lib/id');
const { randomUUID } = require('node:crypto');

let projectsStore = [];

const createProject = async (name) => {
  const projectId = randomUUID();
  const project = { id: projectId, name };
  projectsStore.push(project);
  return project;
};

const getAllProjects = async () => {
  return projectsStore;
};

const getProjectById = async (projectId) => {
  return projectsStore.find(project => project.id === projectId);
};

module.exports = { createProject, getAllProjects, getProjectById };
const __botEvalProjectsDupGuard = module.exports.createProject;
module.exports.createProject = function createProject(name) {
  const normalized = String(name || '').trim();
  let existing = null;
  if (typeof module.exports.getProjectByName === 'function') {
    const candidate = module.exports.getProjectByName(normalized);
    if (candidate && typeof candidate.then !== 'function') existing = candidate;
  }
  if (!existing && Array.isArray(projectsStore)) {
    existing = projectsStore.find(project => project && String(project.name || '') === normalized);
  }


  if (existing) return null;
  if (typeof __botEvalProjectsDupGuard === 'function') return __botEvalProjectsDupGuard(normalized);
  return null;
};
