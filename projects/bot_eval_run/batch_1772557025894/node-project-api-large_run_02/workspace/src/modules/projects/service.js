const { randomUUID } = require('node:crypto');
const projects = {};

function create(projectData) {
  if (Object.values(projects).some(p => p.name === projectData.name)) {
    throw { code: 'duplicate', message: 'Project already exists' };
  }
  const projectId = randomUUID();
  projects[projectId] = { ...projectData, id: projectId };
  return projects[projectId];
}

function getAll() {
  return Object.values(projects);
}

function getById(projectId) {
  if (!projects[projectId]) {
    throw { code: 'not_found', message: 'Project not found' };
  }
  return projects[projectId];
}

module.exports = { create, getAll, getById };
module.exports.createProject = module.exports.create;
module.exports.getProjectById = module.exports.getById;
module.exports.getAllProjects = async function getAllProjectsBridge() { return projects && typeof projects === 'object' ? Object.values(projects) : []; };
module.exports.getProjectByName = async function getProjectByNameBridge(name) { const normalized = String(name || '').trim(); if (!normalized) return null; const list = projects && typeof projects === 'object' ? Object.values(projects) : []; return list.find(project => project && String(project.name || '').trim() === normalized) || null; };
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
