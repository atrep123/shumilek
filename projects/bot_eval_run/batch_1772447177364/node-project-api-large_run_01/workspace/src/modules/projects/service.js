const { randomUUID } = require('node:crypto');

let projects = [];

const getProjectById = (projectId) => {
  return projects.find(p => p.id === projectId);
};

const createProject = (name) => {
  const project = { id: randomUUID(), name };
  projects.push(project);
  return project;
};

module.exports = {
  getProjectById,
  createProject
};
