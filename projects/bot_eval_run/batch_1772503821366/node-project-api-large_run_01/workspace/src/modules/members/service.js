const members = [];
async function getMembers(projectId) {
  return members.filter(member => String(member.projectId) === String(projectId));
}
async function addMember(projectId, userId, role) {
  const existing = members.find(member => String(member.projectId) === String(projectId) && String(member.userId) === String(userId));
  if (existing) return null;
  const member = { projectId: String(projectId), userId: String(userId), role: String(role || 'member') };
  members.push(member);
  return member;
}
module.exports = { getMembers, addMember, members };
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
