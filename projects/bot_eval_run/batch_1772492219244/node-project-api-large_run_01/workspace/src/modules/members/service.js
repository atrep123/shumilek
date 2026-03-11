// src/modules/members/service.js
const { randomUUID } = require('node:crypto');

let membersStore = [];

const createMember = (userId, role) => {
  const member = { id: randomUUID(), userId, role };
  membersStore.push(member);
  return member;
};

module.exports = {
  createMember,
};