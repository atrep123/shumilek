const { randomUUID } = require('../../lib/id');

let membersStore = {};

const addMember = async (projectId, userId, role) => {
  const memberId = randomUUID();
  if (!membersStore[projectId]) {
    membersStore[projectId] = [];
  }
  membersStore[projectId].push({ id: memberId, userId, role });
  return { id: memberId, userId, role };
};

module.exports = { addMember };
module.exports.createMember = module.exports.addMember;
module.exports.getAllMembers = async function getAllMembersBridge(_projectId) { return []; };
