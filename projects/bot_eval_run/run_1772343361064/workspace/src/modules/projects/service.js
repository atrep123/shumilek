const { generateId } = require('../../lib/id');
let projectsStore = {};

const createProject = (name) => {
  const projectId = generateId();
  const project = { id: projectId, name, tasks: [], members: [] };
  projectsStore[projectId] = project;

  return project;
};

const getAllProjects = () => {
  return Object.values(projectsStore);
};

const getProjectById = (projectId) => {
  return projectsStore[projectId];
};

module.exports = { createProject, getAllProjects, getProjectById };
