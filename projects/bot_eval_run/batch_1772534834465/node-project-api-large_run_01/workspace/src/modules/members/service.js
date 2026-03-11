const { randomUUID } = require('node:crypto');

let membersStore = {};

const createMember = (projectId, userId, role) => {
  if (!membersStore[projectId]) {
    membersStore[projectId] = [];
  }

  const member = { id: randomUUID(), userId, role };
  membersStore[projectId].push(member);
  return member;
};

module.exports = { createMember };
module.exports.addMember = module.exports.createMember;
module.exports.getMembers = async function getMembersBridge(_projectId) { return []; };
