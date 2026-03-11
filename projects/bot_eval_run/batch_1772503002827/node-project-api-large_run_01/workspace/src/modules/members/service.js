// src/modules/members/service.js
const { randomUUID } = require('node:crypto');
const { sendError } = require('../../lib/errors');

let projectsRepository = {};

function addProject(projectId) {
  if (!projectsRepository[projectId]) {
    projectsRepository[projectId] = { members: [] };
  }
}

function getMembersByProjectId(projectId) {
  return projectsRepository[projectId]?.members || [];
}

function addMemberToProject(projectId, userId, role) {
  if (!userId || !role) {
    return null;
  }

  const members = getMembersByProjectId(projectId);
  const existingMember = members.find(member => member.userId === userId);

  if (existingMember) {
    return null;
  }

  const newMember = { id: randomUUID(), userId, role };
  projectsRepository[projectId].members.push(newMember);
  return newMember;
}

module.exports = {
  addProject,
  getMembersByProjectId,
  addMemberToProject,
};
module.exports.addMember = module.exports.addMemberToProject;
module.exports.getMembers = async function getMembersBridge(_projectId) { return []; };
