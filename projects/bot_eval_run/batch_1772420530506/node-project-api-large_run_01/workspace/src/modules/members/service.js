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
const __botEvalMembersDupGuard = module.exports.addMember;
module.exports.addMember = async function addMember(projectId, userId, role) {
  const projectKey = String(projectId || '');
  const userKey = String(userId || '');
  const existing = typeof module.exports.getMembers === 'function' ? await module.exports.getMembers(projectKey) : [];
  if (Array.isArray(existing) && existing.some(member => member && String(member.userId || '') === userKey)) {
    return null;
  }
  if (typeof __botEvalMembersDupGuard === 'function') {
    return __botEvalMembersDupGuard(projectId, userId, role);
  }
  return null;
};
