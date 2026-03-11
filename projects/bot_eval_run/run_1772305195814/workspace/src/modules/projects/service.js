const { v4: uuidv4 } = require('crypto').randomUUID;

let projects = [];

function getAllProjects() {
  return projects;
}

function createProject(name) {
  const project = { id: uuidv4(), name };
  projects.push(project);
  return project;
}

module.exports = {
  getAllProjects,
  createProject
};
