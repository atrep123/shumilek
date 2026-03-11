const { randomUUID } = require('../../lib/id');

let membersStore = [];

const addMember = async (projectId, userId, role) => {
  const memberId = randomUUID();
  const member = { id: memberId, projectId, userId, role };
  membersStore.push(member);
  return member;
};

module.exports = { addMember };