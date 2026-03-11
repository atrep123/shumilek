// src/modules/projects/service.js
const { randomUUID } = require('node:crypto');

let projects = [];

const createProject = async (name) => {
  const project = { id: randomUUID(), name, members: [], tasks: [] };
  projects.push(project);
  return project;
};

const getProject = async (projectId) => {
  return projects.find(p => p.id === projectId);
};

module.exports = { createProject, getProject };
module.exports.getProjectById = module.exports.getProject;
module.exports.getAllProjects = async function getAllProjectsBridge() { return Array.isArray(projects) ? [...projects] : []; };
