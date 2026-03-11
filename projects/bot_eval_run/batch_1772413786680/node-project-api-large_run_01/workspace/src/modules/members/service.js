const { randomUUID } = require('../../lib/id');

let membersStore = [];

const addMember = async (projectId, userId, role) => {
  const memberId = randomUUID();
  const member = { id: memberId, projectId, userId, role };
  membersStore.push(member);
  return member;
};

const getMembers = async (projectId) => {
  return membersStore.filter(member => member.projectId === projectId);
};

module.exports = { addMember, getMembers };
