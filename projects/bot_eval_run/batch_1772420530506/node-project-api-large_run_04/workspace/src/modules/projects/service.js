// src/modules/projects/service.js
const { randomUUID } = require('node:crypto');

let projectsStore = [];

module.exports = {
  getProjectById(id) {
    return projectsStore.find(project => project.id === id);
  },
  createProject(name) {
    if (!name) return null;
    const newProject = { id: randomUUID(), name };
    projectsStore.push(newProject);
    return newProject;
  }
};
module.exports.getAllProjects = async function getAllProjectsBridge() { return Array.isArray(projectsStore) ? [...projectsStore] : []; };
