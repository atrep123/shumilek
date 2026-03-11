// src/modules/members/service.js
const projectsService = require('../projects/service');
const { randomUUID } = require('node:crypto');

const addMember = async (projectId, userId, role) => {
  const project = await projectsService.getProject(projectId);
  if (!project) {
    return null;
  }
  const member = { id: randomUUID(), projectId, userId, role };
  project.members.push(member);
  return member;
};

module.exports = { addMember };
