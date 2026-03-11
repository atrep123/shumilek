const { randomUUID } = require('../../lib/id');

let membersStore = [];

const addMember = async (projectId, userId, role) => {
  const existingMember = membersStore.find(member => member.projectId === projectId && member.userId === userId);
  if (existingMember) {
    throw { code: 'DUPLICATE_MEMBER' };
  }
  const memberId = randomUUID();
  const member = { id: memberId, projectId, userId, role };
  membersStore.push(member);
  return member;
};

module.exports = { addMember };
