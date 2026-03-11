// src/modules/members/service.js
const { randomUUID } = require('node:crypto');
const membersStore = [];

async function addMember(projectId, userId, role) {
  const member = {
    id: randomUUID(),
    projectId,
    userId,
    role,
    createdAt: new Date().toISOString()
  };
  membersStore.push(member);
  return member;
}

module.exports = {
  addMember
};
module.exports.createMember = module.exports.addMember;
