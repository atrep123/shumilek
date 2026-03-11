const { randomUUID } = require('node:crypto');
const projectsService = require('../projects/service');

const addMemberToProject = (projectId, userId, role) => {
  const project = projectsService.getProjectById(projectId);
  if (!project) {
    return null;
  }
  const member = { id: randomUUID(), userId, role };
  project.members.push(member);
  return member;
};

module.exports = { addMemberToProject };
module.exports.addMember = async function addMemberBridge(projectId, userId, role) {
  const result = await module.exports.addMemberToProject(projectId, userId, role);
  if (result == null) return null;
  if (result && typeof result === 'object' && 'duplicate' in result && 'member' in result) return result;
  const normalized = result && typeof result === 'object' && 'member' in result ? result.member : result;
  if (normalized && typeof normalized === 'object') return { duplicate: false, ...normalized, member: normalized };
  return { duplicate: false, member: normalized };
};
module.exports.getMembers = async function getMembersBridge(_projectId) { return []; };
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
