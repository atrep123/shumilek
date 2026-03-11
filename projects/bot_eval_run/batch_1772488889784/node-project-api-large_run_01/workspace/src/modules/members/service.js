// src/modules/members/service.js
const { randomUUID } = require('node:crypto');
const { sendError } = require('../../lib/errors');

let membersStore = [];

async function createMember(userId, role) {
  if (!userId || !role) {
    return null;
  }
  const existingMember = membersStore.find(m => m.userId === userId);
  if (existingMember) {
    throw { code: 'DUPLICATE', message: 'Member already exists' };
  }
  const member = { id: randomUUID(), userId, role };
  membersStore.push(member);
  return member;
}

module.exports = { createMember };
