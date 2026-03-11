// src/modules/members/service.js
const { randomUUID } = require('node:crypto');
const projectsStore = require('../projects/service').projectsStore;

async function addMember(projectId, userId, role) {
  const project = projectsStore.find(p => p.id === projectId);
  if (!project) {
    throw { code: 'PROJECT_NOT_FOUND' };
  }
  const existingMember = project.members.find(member => member.userId === userId);
  if (existingMember) {
    throw { code: 'DUPLICATE_MEMBER' };
  }
  const newMember = { id: randomUUID(), projectId, userId, role };
  project.members.push(newMember);
  return newMember;
}

module.exports = {
  addMember,
};
