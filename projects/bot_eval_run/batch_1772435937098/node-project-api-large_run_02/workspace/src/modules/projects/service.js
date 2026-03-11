const { generateId } = require('../../lib/id');

let projectsStore = [];

async function getAllProjects() {
  return projectsStore;
}

async function createProject(name) {
  if (projectsStore.some(project => project.name === name)) {
    return null;
  }
  const project = { id: generateId(), name };
  projectsStore.push(project);
  return project;
}

module.exports = { getAllProjects, createProject };
