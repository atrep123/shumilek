// src/modules/projects/service.js
const { randomUUID } = require('node:crypto');

let projects = [];

module.exports = {
  getAllProjects() {
    return projects;
  },

  getProjectById(id) {
    return projects.find(project => project.id === id);
  },

  getProjectByName(name) {
    return projects.find(project => project.name === name);
  },

  createProject(name) {
    if (!name) return null;
    const newProject = { id: randomUUID(), name };
    projects.push(newProject);
    return newProject;
  }
};
