const { randomUUID } = require('node:crypto');

let projects = {};

const getAllProjects = () => {
  return Object.values(projects);
};

const createProject = (name) => {
  const projectId = randomUUID();
  const project = { id: projectId, name, members: [], tasks: [] };
  projects[projectId] = project;
  return project;
};

const getProjectById = (projectId) => {
  return projects[projectId];
};

module.exports = { getAllProjects, createProject, getProjectById };
