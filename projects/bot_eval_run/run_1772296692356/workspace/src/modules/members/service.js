const { generateId } = require('../../lib/id');

const projects = {};

function addMember(projectId, userId, role) {
  if (!projects[projectId]) {
    throw new Error('Project not found');
  }

  const member = { id: generateId(), userId, role };

  projects[projectId].members.push(member);
  return member;
}

function getMembers(projectId) {
  if (!projects[projectId]) {
    throw new Error('Project not found');
  }

  return projects[projectId].members;
}

module.exports = { addMember, getMembers };
