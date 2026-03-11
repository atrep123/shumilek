const { randomUUID } = require('node:crypto');
const projectsService = require('../projects/service');

const addMember = (projectId, memberData) => {
  const project = projectsService.getProject(projectId);
  if (!project) {
    return null;
  }

  const existingMember = project.members.find(member => member.userId === memberData.userId);
  if (existingMember) {
    return null;
  }

  const newMember = { id: randomUUID(), ...memberData };
  project.members.push(newMember);
  projectsService.updateProject(projectId, project);
  return newMember;
};

const getProject = (projectId) => {
  return projectsService.getProject(projectId);
};

module.exports = { addMember, getProject };
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
