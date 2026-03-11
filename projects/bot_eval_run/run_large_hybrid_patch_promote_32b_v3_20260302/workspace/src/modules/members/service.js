const { getProjectById } = require('../projects/service');
const { sendError } = require('../../lib/errors');

const addMember = (projectId, userId, role) => {
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
};

module.exports = { addMember };
