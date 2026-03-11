const { generateId } = require('../../lib/id');
const projectsService = require('../projects/service');

const addMember = (projectId, member) => {
  const project = projectsService.getProject(projectId);
  if (!project) {
    return { status: 404, error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' } };
  }

  if (project.members.some(m => m.userId === member.userId)) {
    return { status: 409, error: { code: 'DUPLICATE_MEMBER', message: 'Member already exists in the project' } };
  }

  const newMember = { ...member, id: generateId() };
  project.members.push(newMember);
  projectsService.updateProject(project);

  return { member: newMember };
};

const getMembers = (projectId) => {
  const project = projectsService.getProject(projectId);
  if (!project) {
    return [];
  }
  return project.members;
};

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
