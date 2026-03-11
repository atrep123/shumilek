// src/modules/members/service.js
const { randomUUID } = require('node:crypto');
const errors = require('../../lib/errors');

let membersStore = [];

async function addMember(projectId, member) {
  const existingMember = membersStore.find(m => m.projectId === projectId && m.userId === member.userId);
  if (existingMember) {
    return null;
  }

  const newMember = {
    id: randomUUID(),
    projectId,
    ...member,
  };
  membersStore.push(newMember);
  return newMember;
}

module.exports = {
  addMember,
};
