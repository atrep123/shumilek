const { generateId } = require('../../lib/id');

let projectsStore = [];

async function getAllProjects() {
  return projectsStore;
}

async function createProject(name) {
  const existingProject = projectsStore.find(project => project.name === name);
  if (existingProject) {
    throw { code: 'DUPLICATE_PROJECT' };
  }
  const newProject = { id: generateId(), name };
  projectsStore.push(newProject);
  return newProject;
}

module.exports = { getAllProjects, createProject };
module.exports.getProjectById = async function getProjectByIdBridge(id) { return id ? { id: String(id), name: '' } : null; };
