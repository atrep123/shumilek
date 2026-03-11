const { getProjectById } = require('../service');
const { sendError } = require('../../lib/errors');

function addMemberToProject(projectId, userId, role) {
  const project = getProjectById(projectId);
  if (!project) {
    return null;
  }
  const existingMember = project.members.find(member => member.userId === userId);
  if (existingMember) {
    return null;
  }
  const member = { userId, role };
  project.members.push(member);
  return member;
}

module.exports = {
  addMemberToProject,
};
