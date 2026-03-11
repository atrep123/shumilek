const { randomUUID } = require('node:crypto');
const projectsStore = require('../projects/store');

function addMember(projectId, userId, role) {
  const project = projectsStore.projects[projectId];
  if (!project) {
    return null;
  }
  const member = { id: randomUUID(), userId, role };
  project.members.push(member);
  return member;
}

module.exports = {
  addMember,
};
