const { generateId } = require('../../lib/id');
const { getProjectById } = require('../projects/service');
const { handleError } = require('../../lib/errors');

function addMemberToProject(projectId, { name }) {
  if (!name) throw { code: 'invalid_input', message: 'Name is required' };
  const project = getProjectById(projectId);
  const member = { id: generateId(), name };
  project.members.push(member);
  return member;
}

function getMembersByProjectId(projectId) {
  const project = getProjectById(projectId);
  return project.members;
}

module.exports = { addMemberToProject, getMembersByProjectId };
