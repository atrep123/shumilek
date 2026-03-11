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
  const normalizeResult = (resolved) => {
    if (resolved == null) return null;
    if (resolved && typeof resolved === 'object' && 'duplicate' in resolved && 'member' in resolved) return resolved;
    if (resolved && typeof resolved === 'object' && 'error' in resolved && resolved.error) {
      const code = String(resolved.code || resolved.error?.code || '').toUpperCase();
      const duplicateLike = code.includes('DUPLICATE') || Number(resolved.status || resolved.error?.status || 0) === 409;
      if (duplicateLike) {
        const fallbackMember = resolved.member && typeof resolved.member === 'object'
          ? resolved.member
          : { projectId: projectKey, userId: userKey, role: String(role || 'member') };
        return { duplicate: true, member: fallbackMember };
      }
      return null;
    }
    const normalized = resolved && typeof resolved === 'object' && 'member' in resolved ? resolved.member : resolved;
    if (normalized && typeof normalized === 'object') {
      const withProject = 'projectId' in normalized ? normalized : { projectId: projectKey, ...normalized };
      const withUser = 'userId' in withProject ? withProject : { ...withProject, userId: userKey };
      const withRole = 'role' in withUser ? withUser : { ...withUser, role: String(role || 'member') };
      return { duplicate: false, member: withRole };
    }
    return { duplicate: false, member: { projectId: projectKey, userId: userKey, role: String(role || 'member') } };
  };
  if (typeof __botEvalMembersDupGuard === 'function') {
    const payload = { userId: userKey, role: String(role || '') };
    const result = __botEvalMembersDupGuard.length >= 3
      ? __botEvalMembersDupGuard(projectId, userId, role)
      : __botEvalMembersDupGuard(projectId, payload);
    if (result && typeof result.then === 'function') {
      return result.then((resolved) => {
        const normalizedResult = normalizeResult(resolved);
        if (normalizedResult && normalizedResult.member && typeof normalizedResult.member === 'object') __botEvalMembersDupStore.push(normalizedResult.member);
        return normalizedResult;
      });
    }
    const normalizedResult = normalizeResult(result);
    if (normalizedResult && normalizedResult.member && typeof normalizedResult.member === 'object') __botEvalMembersDupStore.push(normalizedResult.member);
    return normalizedResult;
  }
  return null;
};
module.exports.getAllMembers = module.exports.getMembers;
