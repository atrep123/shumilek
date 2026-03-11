// src/modules/members/service.js
const { randomUUID } = require('node:crypto');
const projectsService = require('../projects/service');

async function addMember(projectId, memberData) {
  const project = await projectsService.getProjectById(projectId);
  if (!project) {
    return null;
  }

  const existingMember = project.members.find(m => m.userId === memberData.userId);
  if (existingMember) {
    throw { code: 'DUPLICATE_MEMBER', message: 'Member already exists in this project' };
  }

  const newMember = {
    id: randomUUID(),
    ...memberData,
  };

  project.members.push(newMember);
  await projectsService.updateProject(projectId, project);

  return newMember;
}

module.exports = { addMember };
