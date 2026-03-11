const { generateId } = require('../../lib/id');

let membersStore = [];

async function getAllMembers(projectId) {
  return membersStore.filter(member => member.projectId === projectId);
}

async function addMember(projectId, userId, role) {
  if (!membersStore.some(member => member.projectId === projectId)) {
    return null;
  }
  const member = { id: generateId(), projectId, userId, role };
  membersStore.push(member);
  return member;
}

module.exports = { getAllMembers, addMember };
