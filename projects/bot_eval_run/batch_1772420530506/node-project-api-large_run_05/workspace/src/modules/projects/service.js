const { randomUUID } = require('../../lib/id');

let projectsStore = [];

const getAllProjects = () => {
  return Promise.resolve(projectsStore);
};

const createProject = (name) => {
  const project = { id: randomUUID(), name };
  projectsStore.push(project);
  return Promise.resolve(project);
};

module.exports = { getAllProjects, createProject };
