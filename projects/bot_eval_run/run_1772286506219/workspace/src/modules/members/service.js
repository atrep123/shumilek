const { createError } = require('../../lib/errors');
let projects = require('../projects/service').getProjects();

function addMemberToProject(projectId, data) {
  const project = projects.find(p => p.id === projectId);
  if (!project) return createError(404, 'NOT_FOUND', 'Project not found');
  if (!data.userId || !data.role) return createError(400, 'INVALID_DATA', 'UserId and role are required');
  const memberExists = project.members.some(m => m.userId === data.userId);
  if (memberExists) return createError(409, 'DUPLICATE_MEMBER', 'Member already exists in the project');
  const member = { userId: data.userId, role: data.role };
  project.members.push(member);
  return member;
}

module.exports = { addMemberToProject };
