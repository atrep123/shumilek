const projectStore = require('../projects/store');
const { randomUUID } = require('node:crypto');
const { sendError } = require('../../lib/errors');

function addMember(projectId, userId, role) {
  const project = projectStore.projects.find(p => p.id === projectId);
  if (!project) {
    return null;
  }
  const member = { id: randomUUID(), userId, role };
  project.members.push(member);
  return member;
}

function getMembers(projectId) {
  const project = projectStore.projects.find(p => p.id === projectId);
  if (!project) {
    return null;
  }
  return project.members;
}

module.exports = {
  addMember,
  getMembers,
};
