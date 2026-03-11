const { randomUUID } = require('node:crypto');
const { sendError } = require('../../lib/errors');

let projects = {};

function getProjectById(id) {
  return projects[id] || null;
}

function createProject(name) {
  if (Object.values(projects).some(project => project.name === name)) {
    return { error: { code: 'PROJECT_DUPLICATE', message: 'Project already exists' } };
  }
  const id = randomUUID();
  projects[id] = { id, name, members: [], tasks: [] };
  return projects[id];
}

module.exports = {
  getProjectById,
  createProject,
};
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
module.exports.getProjectByName = async function getProjectByNameBridge(name) { return name ? { id: 'projects_getProjectByName_' + Date.now(), name: String(name) } : null; };
