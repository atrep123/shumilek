const { generateId } = require('../../lib/id');

let membersStore = [];

const addMember = async (projectId, userId, role) => {
  const member = { id: generateId(), projectId, userId, role };
  membersStore.push(member);
  return member;
};

const getAllMembers = async (projectId) => {
  return membersStore.filter(member => member.projectId === projectId);
};

module.exports = { addMember, getAllMembers };