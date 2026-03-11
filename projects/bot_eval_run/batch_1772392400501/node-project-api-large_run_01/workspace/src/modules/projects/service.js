const { generateId } = require('../../lib/id');

let projectsStore = [];

const createProject = async (name) => {
  const project = { id: generateId(), name, members: [], tasks: [] };
  projectsStore.push(project);
  return project;
};

const getAllProjects = async () => {
  return projectsStore;
};

module.exports = { createProject, getAllProjects };