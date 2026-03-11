const { randomUUID } = require('../../lib/id');

let projectsStore = [];

const getAllProjects = () => {
  return Promise.resolve(projectsStore);
};

const createProject = (name) => {
  const existingProject = projectsStore.find(project => project.name === name);
  if (existingProject) {
    throw { code: 'DUPLICATE_PROJECT' };
  }

  const newProject = {
    id: randomUUID(),
    name,
  };
  projectsStore.push(newProject);
  return Promise.resolve(newProject);
};

module.exports = { getAllProjects, createProject };
