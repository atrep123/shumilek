const { randomUUID } = require('node:crypto');

let projects = {};

function addMember(projectId, member) {
  if (!projects[projectId]) {
    projects[projectId] = [];
  }

  const existingMember = projects[projectId].find(m => m.userId === member.userId);
  if (existingMember) {
    return null;
  }

  const newMember = { id: randomUUID(), ...member };
  projects[projectId].push(newMember);
  return newMember;
}

function getMembers(projectId) {
  return projects[projectId] || [];
}

module.exports = {
  addMember,
  getMembers,
};
