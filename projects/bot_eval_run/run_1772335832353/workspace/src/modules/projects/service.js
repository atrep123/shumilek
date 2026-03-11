const { generateId } = require('../../lib/id');
let projectsStore = {};

const createProject = (name) => {
  const projectId = generateId();
  const project = { id: projectId, name, members: [], tasks: {} };
  projectsStore[projectId] = project;
  return project;
};

const getAllProjects = () => {
  return Object.values(projectsStore);
};

module.exports = { createProject, getAllProjects };
