const { randomUUID } = require('../../lib/id');

let projectsStore = {};

const getProject = async (projectId) => {
  return projectsStore[projectId];
};

const createProject = async (name) => {
  const projectId = randomUUID();
  projectsStore[projectId] = { id: projectId, name };
  return { id: projectId, name };
};

module.exports = { getProject, createProject };
module.exports.getProjectById = module.exports.getProject;
