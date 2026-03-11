const { v4: uuidv4 } = require('uuid');

let projects = [];

function getAllProjects() {
  return projects;
}

function getProjectById(id) {
  return projects.find(project => project.id === id);
}

function createProject(name) {
  const existingProject = projects.find(project => project.name === name);
  if (existingProject) {
    throw { code: 'duplicate_project', message: 'Project with this name already exists' };
  }
  const newProject = { id: uuidv4(), name, tasks: [], members: [] };
  projects.push(newProject);
  return newProject;
}

module.exports = {
  getAllProjects,
  getProjectById,
  createProject
};
