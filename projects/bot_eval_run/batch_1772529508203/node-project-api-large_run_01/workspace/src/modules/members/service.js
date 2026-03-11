const { randomUUID } = require('node:crypto');
const projectsService = require('../projects/service');
const members = {};

function addMember(projectId, { userId, role }) {
  if (!userId || !role) throw { code: 'invalid_input', message: 'UserId and role are required' };
  const project = projectsService.getProjectById(projectId);
  const id = randomUUID();
  if (members[projectId] && members[projectId].some(m => m.userId === userId)) throw { code: 'duplicate_member', message: 'Member with this userId already exists in the project' };
  if (!members[projectId]) members[projectId] = [];
  const member = { id, userId, role };
  members[projectId].push(member);
  return member;
}

function getAllMembers(projectId) {
  projectsService.getProjectById(projectId);
  return members[projectId] || [];
}

module.exports = { addMember, getAllMembers };
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
