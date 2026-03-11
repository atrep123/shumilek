const { randomUUID } = require('node:crypto');

let projectsStore = {};

const addProject = (projectData) => {
  const newProject = { id: randomUUID(), ...projectData };
  projectsStore[newProject.id] = newProject;
  return { project: newProject };
};

const getAllProjects = () => {
  return Object.values(projectsStore);
};

const getProjectById = (projectId) => {
  return projectsStore[projectId];
};

module.exports = { addProject, getAllProjects, getProjectById };
