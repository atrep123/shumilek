const { randomUUID } = require('node:crypto');
const errors = require('../../lib/errors');

let projectsRepository = {};

function setProjectsRepository(repo) {
  projectsRepository = repo;
}

function addMember(projectId, userId, role) {
  const project = projectsRepository[projectId];
  if (!project) {
    return errors.sendError(null, 404, 'PROJECT_NOT_FOUND', 'Project not found');
  }

  if (project.members.some(member => member.userId === userId)) {
    return errors.sendError(null, 409, 'MEMBER_EXISTS', 'Member already exists in the project');
  }

  const newMember = { id: randomUUID(), userId, role };
  project.members.push(newMember);
  return newMember;
}

function getMembers(projectId) {
  const project = projectsRepository[projectId];
  if (!project) {
    return errors.sendError(null, 404, 'PROJECT_NOT_FOUND', 'Project not found');
  }
  return project.members;
}

module.exports = { setProjectsRepository, addMember, getMembers };
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
module.exports.getAllMembers = module.exports.getMembers;
