const { randomUUID } = require('node:crypto');

let projects = [];

const addProject = (project) => {
  const newProject = { ...project, id: randomUUID(), members: [], tasks: [] };
  projects.push(newProject);
  return newProject;
};

const getProject = (projectId) => {
  return projects.find(p => p.id === projectId);
};

const findProjectByTask = (taskId) => {
  return projects.find(p => p.tasks.some(t => t.id === taskId));
};

module.exports = { addProject, getProject, findProjectByTask };
