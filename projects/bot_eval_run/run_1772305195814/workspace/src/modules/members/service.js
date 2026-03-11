const { v4: uuidv4 } = require('crypto').randomUUID;
const projectService = require('../projects/service');

function addMember(projectId, userId, role) {
  const project = projectService.getAllProjects().find(p => p.id === projectId);
  if (!project) {
    throw new Error('Project not found');
  }
  const member = { id: uuidv4(), userId, role };
  if (!project.members) {
    project.members = [];
  }
  project.members.push(member);
  return member;
}

module.exports = {
  addMember
};
