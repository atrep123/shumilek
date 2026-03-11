const { randomUUID } = require('node:crypto');
const projectService = require('../projects/service');

let members = [];

function addMember(projectId, userId, role) {
  const project = projectService.getProjectById(projectId);
  if (!project) return null;

  const existingMember = members.find(m => m.projectId === projectId && m.userId === userId);
  if (existingMember) return 'DUPLICATE';

  const member = { id: randomUUID(), projectId, userId, role };
  members.push(member);
  return member;
}

function getMembersByProject(projectId) {
  const project = projectService.getProjectById(projectId);
  if (!project) return null;

  return members.filter(m => m.projectId === projectId);
}

module.exports = {
  addMember,
  getMembersByProject,
};
