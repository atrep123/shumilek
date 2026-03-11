const { randomUUID } = require('../../lib/id');

let projectsStore = [];

const createProject = (name) => {
  const projectId = randomUUID();
  const project = { id: projectId, name };
  projectsStore.push(project);
  return Promise.resolve(project);
};

const getProjects = () => {
  return Promise.resolve(projectsStore);
};

module.exports = { createProject, getProjects };
