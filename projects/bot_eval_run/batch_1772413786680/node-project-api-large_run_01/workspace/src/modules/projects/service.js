const { randomUUID } = require('../../lib/id');

let projectsStore = [];

const createProject = async (name) => {
  const projectId = randomUUID();
  const project = { id: projectId, name };
  projectsStore.push(project);
  return project;
};

const getAllProjects = async () => {
  return projectsStore;
};

const getProjectById = async (projectId) => {
  return projectsStore.find(project => project.id === projectId);
};

module.exports = { createProject, getAllProjects, getProjectById };
