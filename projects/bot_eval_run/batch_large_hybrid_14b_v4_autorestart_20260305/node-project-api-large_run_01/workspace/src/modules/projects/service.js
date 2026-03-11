const { randomUUID } = require('node:crypto');
let projects = [];

const createProject = (name) => {
  const projectId = randomUUID();
  const project = { id: projectId, name };
  projects.push(project);
  return project;
};

const getAllProjects = () => {
  return projects;
};

const getProjectById = (projectId) => {
  return projects.find(p => p.id === projectId);
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
  if (!existing && Array.isArray(projects)) {
    existing = projects.find(project => project && String(project.name || '') === normalized);
  }


  if (existing) return null;
  if (typeof __botEvalProjectsDupGuard === 'function') return __botEvalProjectsDupGuard(normalized);
  return null;
};
module.exports.getProjectByName = async function getProjectByNameBridge(name) { const normalized = String(name || '').trim(); if (!normalized) return null; const list = Array.isArray(projects) ? projects : []; return list.find(project => project && String(project.name || '').trim() === normalized) || null; };
