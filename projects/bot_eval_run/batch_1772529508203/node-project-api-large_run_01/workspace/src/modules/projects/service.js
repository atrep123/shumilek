const { randomUUID } = require('node:crypto');
const projects = {};

function createProject({ name }) {
  if (!name) throw { code: 'invalid_input', message: 'Name is required' };
  const id = randomUUID();
  if (Object.values(projects).some(p => p.name === name)) throw { code: 'duplicate_project', message: 'Project with this name already exists' };
  projects[id] = { id, name };
  return projects[id];
}

function getAllProjects() {
  return Object.values(projects);
}

function getProjectById(id) {
  const project = projects[id];
  if (!project) throw { code: 'not_found', message: 'Project not found' };
  return project;
}

module.exports = { createProject, getAllProjects, getProjectById };
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
