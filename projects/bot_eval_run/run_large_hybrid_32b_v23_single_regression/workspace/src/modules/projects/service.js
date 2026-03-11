const { randomUUID } = require('node:crypto');
const projects = {};

function getAllProjects() {
  return Object.values(projects);
}

function createProject(name) {
  const projectId = randomUUID();
  const project = { id: projectId, name, members: [], tasks: [] };
  projects[projectId] = project;
  return project;
}

function getProjectById(projectId) {
  return projects[projectId];
}

module.exports = { getAllProjects, createProject, getProjectById };
const __botEvalProjectsDupGuard = module.exports.createProject;
module.exports.createProject = function createProject(name) {
  const normalized = String(name || '').trim();
  let existing = null;
  if (typeof module.exports.getProjectByName === 'function') {
    const candidate = module.exports.getProjectByName(normalized);
    if (candidate && typeof candidate.then !== 'function') existing = candidate;
  }

  if (!existing && projects && typeof projects === 'object') {
    existing = Object.values(projects).find(project => project && String(project.name || '') === normalized) || null;
  }

  if (existing) return null;
  if (typeof __botEvalProjectsDupGuard === 'function') return __botEvalProjectsDupGuard(normalized);
  return null;
};
module.exports.getProjectByName = async function getProjectByNameBridge(name) { const normalized = String(name || '').trim(); if (!normalized) return null; const list = projects && typeof projects === 'object' ? Object.values(projects) : []; return list.find(project => project && String(project.name || '').trim() === normalized) || null; };
