const { randomUUID } = require('node:crypto');

let projectsStore = {};
let projectsList = [];

function getAllProjects() {
  return projectsList;
}

function createProject(name) {
  const existingProject = projectsList.find(project => project.name === name);
  if (existingProject) return { duplicate: true };

  const projectId = randomUUID();
  const project = { id: projectId, name };
  projectsStore[projectId] = project;
  projectsList.push(project);
  return { project };
}

function getProjectById(projectId) {
  return projectsStore[projectId];
}

function getProjectByTaskId(taskId) {
  for (const projectId in projectsStore) {
    const project = projectsStore[projectId];
    if (project.tasks && project.tasks.some(task => task.id === taskId)) {
      return project;
    }
  }
  return null;
}

module.exports = {
  getAllProjects,
  createProject,
  getProjectById,
  getProjectByTaskId,
};
const __botEvalProjectsDupGuard = module.exports.createProject;
module.exports.createProject = function createProject(name) {
  const normalized = String(name || '').trim();
  let existing = null;
  if (typeof module.exports.getProjectByName === 'function') {
    const candidate = module.exports.getProjectByName(normalized);
    if (candidate && typeof candidate.then !== 'function') existing = candidate;
  }
  if (!existing && Array.isArray(projectsList)) {
    existing = projectsList.find(project => project && String(project.name || '') === normalized);
  }

  if (!existing && projectsStore && typeof projectsStore === 'object') {
    existing = Object.values(projectsStore).find(project => project && String(project.name || '') === normalized) || null;
  }

  if (existing) return null;
  if (typeof __botEvalProjectsDupGuard === 'function') return __botEvalProjectsDupGuard(normalized);
  return null;
};
