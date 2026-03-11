const { randomUUID } = require('../../lib/id');

let projectsStore = [];

const getAllProjects = async () => {
  return projectsStore;
};

const getProjectById = async (projectId) => {
  return projectsStore.find(project => project.id === projectId);
};

const createProject = async (name) => {
  const existingProject = projectsStore.find(project => project.name.toLowerCase() === name.toLowerCase());
  if (existingProject) {
    throw { code: 'DUPLICATE_PROJECT' };
  }
  const projectId = randomUUID();
  const project = { id: projectId, name };
  projectsStore.push(project);
  return project;
};

module.exports = { getAllProjects, getProjectById, createProject };
