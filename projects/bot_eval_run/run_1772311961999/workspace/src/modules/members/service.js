const projectsService = require('../projects/service');

function addMember(projectId, userId, role) {
  const project = projectsService.getProjectById(projectId);
  if (!project) return null;
  const member = { userId, role };
  project.members.push(member);
  return member;
}

function getMembers(projectId) {
  const project = projectsService.getProjectById(projectId);
  if (!project) return null;
  return project.members;
}

module.exports = {
  addMember,
  getMembers
};
