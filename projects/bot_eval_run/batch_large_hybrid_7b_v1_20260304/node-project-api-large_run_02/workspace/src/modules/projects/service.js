const { generateId } = require('../../lib/id');
const projects = [];

async function getAllProjects() { return [...projects]; }

async function getProjectById(projectId) { return projects.find(project => String(project.id) === String(projectId)) || null; }

async function getProjectByName(name) { return projects.find(project => String(project.name) === String(name)) || null; }

async function createProject(name) {
  const project = { id: generateId(), name: String(name || "").trim() };
  projects.push(project);
  return project;
}

module.exports = { getAllProjects, getProjectById, getProjectByName, createProject, projects };
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
