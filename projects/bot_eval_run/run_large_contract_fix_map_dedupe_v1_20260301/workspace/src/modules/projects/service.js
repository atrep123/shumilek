const { randomUUID } = require('node:crypto');
const projectsMap = new Map();

function getProject(projectId) {
  return projectsMap.get(projectId);
}

function createProject({ name }) {
  if (!name) throw new Error('E002', 'Name is required');
  const projectId = randomUUID();
  const project = { id: projectId, name };
  projectsMap.set(projectId, project);
  return project;
}

module.exports = { getProject, createProject };