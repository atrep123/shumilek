const { randomUUID } = require('node:crypto');
const members = [];

function getProjectMembersById(projectId) {
  return members.filter(member => member.projectId === projectId);
}

function createMember(projectId, userId, role) {
  const member = { id: randomUUID(), projectId, userId, role };
  members.push(member);
  return member;
}

module.exports = { getProjectMembersById, createMember };
