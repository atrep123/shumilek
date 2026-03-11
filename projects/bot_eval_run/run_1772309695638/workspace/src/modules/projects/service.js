const { randomUUID } = require('node:crypto');

let projects = [];

function addProject(project) {
  const newProject = { id: randomUUID(), ...project };
  projects.push(newProject);
  return newProject;
}

function getProjects() {
  return projects;
}

module.exports = {
  addProject,
  getProjects,
};
