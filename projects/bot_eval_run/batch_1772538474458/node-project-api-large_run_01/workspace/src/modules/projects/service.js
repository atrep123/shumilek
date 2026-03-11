const { randomUUID } = require('node:crypto');

let projects = {};

function getAllProjects() {
  return Object.values(projects);
}

function createProject(name) {
  const projectId = randomUUID();
  const project = { id: projectId, name };
  projects[projectId] = project;
  return project;
}

function getProjectById(projectId) {
  return projects[projectId];
}

module.exports = {
  getAllProjects,
  createProject,
  getProjectById,
};
const __botEvalProjectsDupGuard = module.exports.createProject;
module.exports.createProject = function createProject(name) {
  const normalized = String(name || '').trim();
  let existing = null;
  if (typeof module.exports.getProjectByName === 'function') {
    const candidate = module.exports.getProjectByName(normalized);
    if (candidate && typeof candidate.then !== 'function') existing = candidate;
  }

  if (existing) return null;
  if (typeof __botEvalProjectsDupGuard === 'function') return __botEvalProjectsDupGuard(normalized);
  return null;
};
