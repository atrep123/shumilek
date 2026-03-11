let membersStore = [];

async function addMember(projectId, userId, role) {
  const member = {
    projectId,
    userId,
    role,
  };
  membersStore.push(member);
  return member;
}

async function getMembers(projectId) {
  return membersStore.filter(member => member.projectId === projectId);
}

module.exports = {
  addMember,
  getMembers,
};