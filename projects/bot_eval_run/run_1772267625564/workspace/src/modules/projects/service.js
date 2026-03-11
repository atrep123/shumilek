function createProject({ name }, { projectsRepo, crypto }) {
  const id = crypto.randomUUID();
  if (Object.values(projectsRepo).some(p => p.name === name)) {
    throw { code: 'duplicate_project', message: 'Project with this name already exists' };
  }
  projectsRepo[id] = { id, name, tasks: [], members: [] };
  return projectsRepo[id];
}

function getProjects({ projectsRepo }) {
  return Object.values(projectsRepo);
}

function getProjectById(id, { projectsRepo }) {
  const project = projectsRepo[id];
  if (!project) throw { code: 'not_found', message: 'Project not found' };
  return project;
}

module.exports = { createProject, getProjects, getProjectById };
