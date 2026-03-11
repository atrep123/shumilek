const { randomUUID } = require('node:crypto');
const projectService = require('../projects/service');

let members = [];

function addMember(projectId, userId, role) {
  const project = projectService.getAllProjects().find(p => p.id === projectId);
  if (!project) return null;

  const member = { id: randomUUID(), projectId, userId, role };
  members.push(member);
  return member;
}

module.exports = {
  addMember,
};
