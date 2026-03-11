const { generateId } = require('../../lib/id');

const projects = {};

function createProject(name) {
  const projectId = generateId();
  const project = { id: projectId, name, members: [], tasks: [] };

  projects[projectId] = project;
  return project;
}

function getProjects() {
  return Object.values(projects);
}

module.exports = { createProject, getProjects };
