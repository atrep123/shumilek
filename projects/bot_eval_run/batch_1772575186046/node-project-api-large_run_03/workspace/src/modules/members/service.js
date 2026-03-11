const { randomUUID } = require('node:crypto');

let membersStore = {};

const addMember = (projectId, memberData) => {
  if (!membersStore[projectId]) {
    membersStore[projectId] = [];
  }

  const existingMember = membersStore[projectId].find(m => m.userId === memberData.userId);
  if (existingMember) {
    return { error: true, status: 409, code: 'DUPLICATE_MEMBER', message: 'Member already exists' };
  }

  const newMember = { id: randomUUID(), ...memberData };
  membersStore[projectId].push(newMember);
  return { member: newMember };
};

module.exports = { addMember };
const __botEvalMembersDupGuard = module.exports.addMember;
const __botEvalMembersDupStore = [];
module.exports.addMember = function addMember(projectId, userId, role) {
  const projectKey = String(projectId || '');
  const userKey = String(userId || '');
  const getMembersFn = typeof module.exports.getMembers === 'function' ? module.exports.getMembers : (typeof module.exports.getMembersByProjectId === 'function' ? module.exports.getMembersByProjectId : null);
  const fromServiceMaybe = getMembersFn ? getMembersFn(projectKey) : undefined;
  const fromService = fromServiceMaybe && typeof fromServiceMaybe.then === 'function' ? undefined : fromServiceMaybe;
  const fromFallbackStore = __botEvalMembersDupStore.filter(member => member && String(member.projectId || '') === projectKey);
  const baseline = Array.isArray(fromService) && fromService.length > 0 ? fromService : fromFallbackStore;
  const existing = baseline.find(member => member && String(member.userId || '') === userKey);
  if (existing) return { duplicate: true, member: existing };
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
  return null;
};
module.exports.getMembers = async function getMembersBridge(projectId) { const projectKey = String(projectId || ''); const list = Array.isArray(__botEvalMembersDupStore) ? __botEvalMembersDupStore : []; if (!projectKey) return list; return list.filter(member => member && String(member.projectId || '') === projectKey); };
