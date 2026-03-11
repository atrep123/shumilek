const { randomUUID } = require('node:crypto');
const { sendError } = require('../../lib/errors');

let projects = {};

function getProject(projectId) {
  return projects[projectId] || null;
}

function createProject(name) {
  if (!name) {
    return null;
  }
  const projectId = randomUUID();
  projects[projectId] = { id: projectId, name, members: [], tasks: [] };
  return projects[projectId];
}

function addMember(projectId, userId, role) {
  const project = getProject(projectId);
  if (!project) {
    return null;
  }
  if (project.members.some(member => member.userId === userId)) {
    return 'duplicate';
  }
  project.members.push({ userId, role });
  return project;
}

module.exports = { getProject, createProject, addMember };
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
module.exports.getProjectById = module.exports.getProject;
module.exports.getAllProjects = async function getAllProjectsBridge() { return projects && typeof projects === 'object' ? Object.values(projects) : []; };
module.exports.getProjectByName = async function getProjectByNameBridge(name) { const normalized = String(name || '').trim(); if (!normalized) return null; const list = projects && typeof projects === 'object' ? Object.values(projects) : []; return list.find(project => project && String(project.name || '').trim() === normalized) || null; };
