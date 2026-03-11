// src/modules/members/service.js
const { randomUUID } = require('node:crypto');
const projectsService = require('../projects/service');
const { sendError } = require('../../lib/errors');

let membersStore = [];

async function addMember(projectId, userId, role) {
  const project = await projectsService.getAllProjects().find(p => p.id === projectId);
  if (!project) {
    return null;
  }

  const existingMember = membersStore.find(m => m.projectId === projectId && m.userId === userId);
  if (existingMember) {
    return null;
  }

  const member = { id: randomUUID(), projectId, userId, role };
  membersStore.push(member);
  return member;
}

module.exports = {
  addMember,
};
