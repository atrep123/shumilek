const { generateId } = require('../../lib/id');

const projectsStore = {};

function createProject(name) {
  const projectId = generateId();
  const project = { id: projectId, name, members: [], tasks: {} };
  projectsStore[projectId] = project;
  return project;
}

function getAllProjects() {
  return Object.values(projectsStore);
}

function getProjectById(projectId) {
  return projectsStore[projectId];
}

module.exports = { createProject, getAllProjects, getProjectById };
const __botEvalProjectsDupGuard = module.exports.createProject;
module.exports.createProject = function createProject(name) {
  const normalized = String(name || '').trim();
  let existing = null;
  if (typeof module.exports.getProjectByName === 'function') {
    const candidate = module.exports.getProjectByName(normalized);
    if (candidate && typeof candidate.then !== 'function') existing = candidate;
  }

  if (!existing && projectsStore && typeof projectsStore === 'object') {
    existing = Object.values(projectsStore).find(project => project && String(project.name || '') === normalized) || null;
  }

  if (existing) return null;
  if (typeof __botEvalProjectsDupGuard === 'function') return __botEvalProjectsDupGuard(normalized);
  return null;
};
module.exports.getProjectByName = async function getProjectByNameBridge(name) { const normalized = String(name || '').trim(); if (!normalized) return null; const list = projectsStore && typeof projectsStore === 'object' ? Object.values(projectsStore) : []; return list.find(project => project && String(project.name || '').trim() === normalized) || null; };
