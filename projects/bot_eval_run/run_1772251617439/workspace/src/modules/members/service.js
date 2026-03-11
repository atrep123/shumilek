const crypto = require('crypto');
const membersRepo = {};

function getMembersByProjectId(projectId) {
  return Object.values(membersRepo).filter(member => member.projectId === projectId);
}

function addMember(projectId, name) {
  if (!name) throw { status: 400, code: 'INVALID_INPUT', message: 'Name is required' };
  const id = crypto.randomUUID();
  membersRepo[id] = { id, projectId, name };
  return membersRepo[id];
}

module.exports = {
  getMembersByProjectId,
  addMember
};
