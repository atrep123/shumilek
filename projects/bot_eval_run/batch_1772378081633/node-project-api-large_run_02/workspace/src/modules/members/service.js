const { randomUUID } = require('../../lib/id');

let membersStore = [];

const addMember = (projectId, userId, role) => {
  const memberId = randomUUID();
  const member = { id: memberId, projectId, userId, role };
  membersStore.push(member);
  return Promise.resolve(member);
};

const getMembers = (projectId) => {
  const members = membersStore.filter(member => member.projectId === projectId);
  return Promise.resolve(members);
};

module.exports = { addMember, getMembers };
