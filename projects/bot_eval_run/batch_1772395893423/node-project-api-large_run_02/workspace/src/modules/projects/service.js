// src/modules/projects/service.js
const { randomUUID } = require('node:crypto');

let projectsStore = [];

module.exports = {
  getAllProjects() {
    return projectsStore;
  },

  getProjectById(id) {
    return projectsStore.find(project => project.id === id);
  },

  getProjectByName(name) {
    return projectsStore.find(project => project.name === name);
  },

  createProject(name) {
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return null;
    }
    const newProject = {
      id: randomUUID(),
      name: name.trim()
    };
    projectsStore.push(newProject);
    return newProject;
  }
};
