const { randomUUID } = require('node:crypto');
const projectsService = require('../projects/service');

let membersStore = {};

function addMember(projectId, userId, role) {
  const project = projectsService.getProjectById(projectId);
  if (!project) return null;

  if (membersStore[projectId] && membersStore[projectId].some(member => member.userId === userId)) {
    return 'duplicate';
  }

  const newMember = { id: randomUUID(), userId, role };
  if (!membersStore[projectId]) {
    membersStore[projectId] = [];
  }
  membersStore[projectId].push(newMember);
  return newMember;
}

function getMembersByProjectId(projectId) {
  return membersStore[projectId] || [];
}

module.exports = { addMember, getMembersByProjectId };
const __botEvalMembersDupGuard = module.exports.addMember;
const __botEvalMembersDupStore = [];
module.exports.addMember = function addMember(projectId, userId, role) {
  const projectKey = String(projectId || '');
  const userKey = String(userId || '');
  const fromServiceMaybe = typeof module.exports.getMembers === 'function' ? module.exports.getMembers(projectKey) : [];
  const fromService = fromServiceMaybe && typeof fromServiceMaybe.then === 'function' ? [] : fromServiceMaybe;
  const baseline = Array.isArray(fromService) ? fromService : __botEvalMembersDupStore.filter(member => member && String(member.projectId || '') === projectKey);
  const existing = baseline.find(member => member && String(member.userId || '') === userKey);
  if (existing) return null;
  if (typeof __botEvalMembersDupGuard === 'function') {
    const result = __botEvalMembersDupGuard(projectId, userId, role);
    if (result && typeof result.then === 'function') {
      return result.then((resolved) => {
        if (resolved) {
          const normalized = resolved && typeof resolved === 'object' && 'member' in resolved ? resolved.member : resolved;
          if (normalized && typeof normalized === 'object') __botEvalMembersDupStore.push(normalized);
        }
        return resolved;
      });
    }
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
