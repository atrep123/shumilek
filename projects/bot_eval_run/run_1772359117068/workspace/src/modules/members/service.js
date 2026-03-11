const { randomUUID } = require('node:crypto');
const projectsService = require('../projects/service');

function addMember(projectId, member) {
  const project = projectsService.getAllProjects().find(p => p.id === projectId);
  if (!project || !project.members) {
    return null;
  }
  const existingMember = project.members.find(m => m.userId === member.userId);
  if (existingMember) {
    return null;
  }
  project.members.push({ ...member, id: randomUUID() });
  return member;
}

module.exports = {
  addMember,
};
