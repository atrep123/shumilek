const { randomUUID } = require('node:crypto');
const projects = [];

const createProject = (name) => {
  const projectId = randomUUID();
  projects.push({ id: projectId, name });
  return { id: projectId, name };
};

const getProjects = () => projects;

const getProjectById = (projectId) => projects.find(p => p.id === projectId);

const getProjectByName = (name) => projects.find(p => p.name === name);

module.exports = { createProject, getProjects, getProjectById, getProjectByName };
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
