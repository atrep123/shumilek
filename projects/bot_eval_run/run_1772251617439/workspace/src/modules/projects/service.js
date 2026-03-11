const crypto = require('crypto');
const projectsRepo = {};

function getAllProjects() {
  return Object.values(projectsRepo);
}

function createProject(name) {
  if (!name) throw { status: 400, code: 'INVALID_INPUT', message: 'Name is required' };
  const id = crypto.randomUUID();
  if (Object.values(projectsRepo).some(p => p.name === name)) {
    throw { status: 409, code: 'DUPLICATE_PROJECT', message: 'Project with this name already exists' };
  }
  projectsRepo[id] = { id, name };
  return projectsRepo[id];
}

function getProjectById(id) {
  const project = projectsRepo[id];
  if (!project) throw { status: 404, code: 'PROJECT_NOT_FOUND', message: 'Project not found' };
  return project;
}

module.exports = {
  getAllProjects,
  createProject,
  getProjectById
};
