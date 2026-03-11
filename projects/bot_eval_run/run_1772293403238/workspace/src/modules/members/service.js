const { BadRequestError, NotFoundError } = require('../../lib/errors');
const projectsService = require('../projects/service');

function addMember(projectId, userId, role) {
  const project = projectsService.getAllProjects().find(p => p.id === projectId);
  if (!project) {
    throw new NotFoundError('Project not found');
  }
  const member = { userId, role };
  project.members.push(member);
  return member;
}

module.exports = {
  addMember,
};
