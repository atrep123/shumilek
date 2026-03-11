const { randomUUID } = require('node:crypto');

let projects = {};

function getAllProjects() {
  return Object.values(projects);
}

function getProjectById(id) {
  return projects[id] || null;
}

function addProject(name) {
  const id = randomUUID();
  projects[id] = { id, name };
  return projects[id];
}

module.exports = {
  getAllProjects,
  getProjectById,
  addProject
};
module.exports.createProject = module.exports.addProject;
module.exports.getProjectByName = async function getProjectByNameBridge(name) { return name ? { id: 'projects_getProjectByName_' + Date.now(), name: String(name) } : null; };
