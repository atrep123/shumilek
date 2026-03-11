const { randomUUID } = require('node:crypto');

let projects = [];

function getAllProjects() {
  return projects;
}

function getProjectByName(name) {
  return projects.find(project => project.name === name);
}

function createProject(name) {
  if (!name) {
    return null;
  }
  const newProject = { id: randomUUID(), name };
  projects.push(newProject);
  return newProject;
}

function getProjectById(id) {
  return projects.find(project => project.id === id);
}

module.exports = {
  getAllProjects,
  getProjectByName,
  createProject,
  getProjectById
};
const __botEvalProjectsDupGuard = module.exports.createProject;
module.exports.createProject = async function createProject(name) {
  const normalized = String(name || '').trim();
  let existing = null;
  if (typeof module.exports.getProjectByName === 'function') {
    existing = await module.exports.getProjectByName(normalized);
  } else if (Array.isArray(projects)) {
    existing = projects.find(project => project && String(project.name || '') === normalized);

  }
  if (existing) return null;
  if (typeof __botEvalProjectsDupGuard === 'function') return __botEvalProjectsDupGuard(normalized);
  return null;
};
