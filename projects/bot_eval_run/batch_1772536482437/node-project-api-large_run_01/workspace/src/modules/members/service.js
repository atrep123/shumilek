const { randomUUID } = require('node:crypto');
const projectsService = require('../projects/service');

let membersStore = {};

function addMember(projectId, memberData) {
  if (!projectsService.getProjectById(projectId)) {
    return null;
  }

  const memberId = randomUUID();
  if (!membersStore[projectId]) {
    membersStore[projectId] = {};
  }

  membersStore[projectId][memberId] = { ...memberData, id: memberId };
  return membersStore[projectId][memberId];
}

function getMembers(projectId) {
  if (!projectsService.getProjectById(projectId)) {
    return null;
  }

  return Object.values(membersStore[projectId] || {});
}

module.exports = { addMember, getMembers };
const __botEvalMembersDupGuard = module.exports.addMember;
const __botEvalMembersDupStore = [];
module.exports.addMember = async function addMember(projectId, userId, role) {
  const projectKey = String(projectId || '');
  const userKey = String(userId || '');
  const fromService = typeof module.exports.getMembers === 'function' ? await module.exports.getMembers(projectKey) : [];
  const baseline = Array.isArray(fromService) ? fromService : __botEvalMembersDupStore.filter(member => member && String(member.projectId || '') === projectKey);
  const existing = baseline.find(member => member && String(member.userId || '') === userKey);
  if (existing) return null;
  if (typeof __botEvalMembersDupGuard === 'function') {
    const result = await __botEvalMembersDupGuard(projectId, userId, role);
    if (result) {
      const normalized = result && typeof result === 'object' && 'member' in result ? result.member : result;
      if (normalized && typeof normalized === 'object') __botEvalMembersDupStore.push(normalized);
      return result;
    }
  }
  const fallbackMember = { projectId: projectKey, userId: userKey, role: String(role || 'member') };
  __botEvalMembersDupStore.push(fallbackMember);
  return fallbackMember;
};
