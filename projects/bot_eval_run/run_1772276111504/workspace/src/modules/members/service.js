const { createError } = require('../../lib');
const projectsService = require('../projects/service');

function addMemberToProject(projectId, name) {
  const project = projectsService.getProjectById(projectId);
  if (project.members.includes(name)) {
    throw createError('duplicate', 'Member already exists in the project.');
  }
  project.members.push(name);
  return { projectId, member: name };
}

module.exports = { addMemberToProject };
