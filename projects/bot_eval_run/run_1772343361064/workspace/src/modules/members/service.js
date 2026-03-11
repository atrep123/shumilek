let membersStore = {};

const addMember = (projectId, userId, role) => {
  if (!membersStore[projectId]) {
    membersStore[projectId] = [];
  }

  const member = { userId, role };
  membersStore[projectId].push(member);

  return member;
};

const getMembers = (projectId) => {
  if (!membersStore[projectId]) {
    return [];
  }

  return membersStore[projectId];
};

module.exports = { addMember, getMembers };
