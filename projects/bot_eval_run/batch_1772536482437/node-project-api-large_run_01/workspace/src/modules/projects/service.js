const { randomUUID } = require('node:crypto');

let projectsStore = {};

function createProject(name) {
  const projectId = randomUUID();
  projectsStore[projectId] = { id: projectId, name };
  return projectsStore[projectId];
}

function getProjectById(projectId) {
  return projectsStore[projectId] || null;
}

function getAllProjects() {
  return Object.values(projectsStore);
}

module.exports = { createProject, getProjectById, getAllProjects };
const __botEvalProjectsDupGuard = module.exports.createProject;
module.exports.createProject = async function createProject(name) {
  const normalized = String(name || '').trim();
  let existing = null;
  if (typeof module.exports.getProjectByName === 'function') {
    existing = await module.exports.getProjectByName(normalized);

  }
  if (existing) return null;
  if (typeof __botEvalProjectsDupGuard === 'function') return __botEvalProjectsDupGuard(normalized);
  return null;
};
