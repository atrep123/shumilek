// src/modules/members/service.js
const { randomUUID } = require('node:crypto');

let membersStore = [];

const addMember = (projectId, userId, role) => {
  const member = { id: randomUUID(), projectId, userId, role };
  membersStore.push(member);
  return member;
};

module.exports = { addMember };