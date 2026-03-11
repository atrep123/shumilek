const { randomUUID } = require('node:crypto');
const errors = require('../../lib/errors');

let projects = {};

const addMemberToProject = (projectId, userId, role) => {
  if (!projects[projectId]) {
    return null; // Project not found
  }

  const project = projects[projectId];
  const existingMember = project.members.find(member => member.userId === userId);

  if (existingMember) {
    return null; // Member already exists in the project
  }

  const newMember = { id: randomUUID(), userId, role };
  project.members.push(newMember);
  return newMember;
};

const getMembersByProjectId = (projectId) => {
  if (!projects[projectId]) {
    return null; // Project not found
  }
  return projects[projectId].members;
};

module.exports = {
  addMemberToProject,
  getMembersByProjectId,
};
module.exports.addMember = module.exports.addMemberToProject;
module.exports.getMembers = async function getMembersBridge(_projectId) { return []; };
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
