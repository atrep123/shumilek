let projects = [];

const createProject = (name) => {
  const projectId = randomUUID();
  const project = { id: projectId, name };
  projects.push(project);
  return project;
};

const getAllProjects = () => {
  return projects;
};

const getProjectById = (projectId) => {
  return projects.find(p => p.id === projectId);
};

module.exports = { createProject, getAllProjects, getProjectById };
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
