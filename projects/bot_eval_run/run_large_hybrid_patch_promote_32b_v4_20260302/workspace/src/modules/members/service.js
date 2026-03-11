const { randomUUID } = require('node:crypto');
const projectsService = require('../projects/service');

const addMember = (projectId, member) => {
  const project = projectsService.getProject(projectId);
  if (!project) return null;

  const existingMember = project.members.find(m => m.userId === member.userId);
  if (existingMember) return null;

  project.members.push({ ...member, id: randomUUID() });
  return member;
};

module.exports = { addMember };
