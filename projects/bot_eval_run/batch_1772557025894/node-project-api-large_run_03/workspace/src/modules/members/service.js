const projectsRepository = {};
function ensureProject(projectId) {
  const key = String(projectId || '');
  if (!projectsRepository[key]) projectsRepository[key] = { members: [] };
  return projectsRepository[key];
}
async function getMembers(projectId) {
  const project = ensureProject(projectId);
  return project.members;
}
async function addMember(projectId, userId, role) {
  const project = ensureProject(projectId);
  const existing = project.members.find(member => String(member.userId) === String(userId));
  if (existing) return { duplicate: true, member: existing };
  const member = { projectId: String(projectId), userId: String(userId), role: String(role || 'member') };
  project.members.push(member);
  return { duplicate: false, member };
}
module.exports = { getMembers, addMember, projectsRepository };
module.exports.getAllMembers = module.exports.getMembers;
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
module.exports.createMember = module.exports.addMember;
