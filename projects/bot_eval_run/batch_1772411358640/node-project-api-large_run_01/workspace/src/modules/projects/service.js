// src/modules/projects/service.js
const { randomUUID } = require('node:crypto');

let projectsStore = [];

module.exports = {
  getAllProjects() {
    return projectsStore;
  },

  getProjectById(id) {
    return projectsStore.find(project => project.id === id);
  }
};
module.exports.createProject = async function createProjectBridge(name) { return { id: 'projects_createProject_' + Date.now(), name: String(name || '') }; };
