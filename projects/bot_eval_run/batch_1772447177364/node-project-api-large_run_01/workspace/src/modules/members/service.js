const { randomUUID } = require('node:crypto');

let members = [];

const addMember = (projectId, userId, role) => {
  const member = { id: randomUUID(), projectId, userId, role };
  members.push(member);
  return member;
};

module.exports = {
  addMember
};
