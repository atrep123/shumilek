const { randomUUID } = require('node:crypto');
const projects = [];

function getProjectById(projectId) {
  return projects.find(project => project.id === projectId);
}

function createProject(name) {
  if (!name) {
    return null;
  }
  const project = { id: randomUUID(), name };
  projects.push(project);
  return project;
}

module.exports = { getProjectById, createProject };
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
module.exports.getAllProjects = async function getAllProjectsBridge() { return Array.isArray(projects) ? [...projects] : []; };
module.exports.getProjectByName = async function getProjectByNameBridge(name) { const normalized = String(name || '').trim(); if (!normalized) return null; const list = Array.isArray(projects) ? projects : []; return list.find(project => project && String(project.name || '').trim() === normalized) || null; };
