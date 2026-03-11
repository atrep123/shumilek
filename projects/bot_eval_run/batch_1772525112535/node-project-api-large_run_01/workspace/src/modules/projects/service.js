const { randomUUID } = require('node:crypto');
const errors = require('../../lib/errors');

let projects = {};

function getAllProjects() {
  return Object.values(projects);
}

function getProjectById(projectId) {
  const project = projects[projectId];
  if (!project) {
    throw new errors.NotFoundError('Project not found');
  }
  return project;
}

function createProject(name) {
  if (!name) {
    throw new errors.BadRequestError('Name is required');
  }
  const projectId = randomUUID();
  projects[projectId] = { id: projectId, name, members: [], tasks: [] };
  return projects[projectId];
}

module.exports = {
  getAllProjects,
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
