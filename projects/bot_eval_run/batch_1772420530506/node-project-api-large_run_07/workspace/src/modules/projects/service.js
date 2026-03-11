const { randomUUID } = require('node:crypto');

let projectsStore = [];

const getAllProjects = () => {
  return Promise.resolve(projectsStore);
};

const getProjectById = (projectId) => {
  return Promise.resolve(projectsStore.find(p => p.id === projectId));
};

const createProject = (name) => {
  const project = { id: randomUUID(), name };
  projectsStore.push(project);
  return Promise.resolve(project);
};

module.exports = {
  getAllProjects,
  getProjectById,
  createProject
};
